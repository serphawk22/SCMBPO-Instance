"""
Email Agent — Excel / CSV upload -> personalized emails to every row.

  GET  /email-campaigns/sender          the company mailbox these emails will go out from
  POST /email-campaigns/parse           upload .xlsx/.csv -> columns, rows, detected columns, stats
  POST /email-campaigns/preview         render the template (optionally AI-personalized) for a few rows
  POST /email-campaigns                 create the campaign and start sending in the background
  GET  /email-campaigns                 campaigns with sent / failed / skipped counts
  GET  /email-campaigns/{id}            one campaign + its recipients (status, sent time, error)
  GET  /email-campaigns/{id}/export     the send record as CSV (recipient, date/time, status)
  POST /email-campaigns/{id}/cancel     stop sending (rows not yet sent stay Pending)
  POST /email-campaigns/{id}/retry      re-queue Failed rows (and resume a cancelled/failed campaign)

Mail goes out from the sender's own Email Integration, else the company mailbox in
Settings -> SMTP — never the server's fixed EMAIL_SENDER (modules/company_mailer.py).
Access: Admin / SuperAdmin / Demo see every campaign in the tenant; SalesManager / Employee
see their own; other roles get 403 (same role model as the Inbox).
"""
import csv
import io
import os
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select

import database
from database import EmailCampaign, EmailCampaignRecipient, Tenant
from modules import company_mailer
from modules import email_campaign_worker as worker
from routers import inbox

router = APIRouter(tags=["email-campaigns"])


def get_session():
    with Session(database.engine) as session:
        yield session


def get_viewer(request: Request, session: Session = Depends(get_session)) -> inbox.Viewer:
    try:
        return inbox.get_viewer(request, session)
    except HTTPException as e:
        if e.status_code == 403:
            raise HTTPException(status_code=403, detail="Your role cannot send email campaigns.")
        raise


def _tenant_of(v: inbox.Viewer) -> Optional[int]:
    return v.tenant_id if v.tenant_id is not None else v.user.tenant_id


def _scope(stmt, v: inbox.Viewer):
    if v.tenant_id is not None:
        stmt = stmt.where(EmailCampaign.tenant_id == v.tenant_id)
    return stmt if v.full_access else stmt.where(EmailCampaign.created_by == v.user.id)


def _load(session: Session, v: inbox.Viewer, campaign_id: int) -> EmailCampaign:
    c = session.exec(_scope(select(EmailCampaign).where(EmailCampaign.id == campaign_id), v)).first()
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return c


def _iso(dt):
    from modules.followups_core import as_utc
    return as_utc(dt).isoformat() if dt else None


def _campaign_dict(c: EmailCampaign) -> dict:
    pending = max(0, (c.total or 0) - (c.sent_count or 0) - (c.failed_count or 0) - (c.skipped_count or 0))
    return {
        "id": c.id, "name": c.name, "source_filename": c.source_filename, "status": c.status,
        "subject_template": c.subject_template, "body_template": c.body_template,
        "ai_personalize": bool(c.ai_personalize), "ai_instructions": c.ai_instructions,
        "create_leads": bool(c.create_leads), "followup_days": c.followup_days,
        "sender_email": c.sender_email, "sender_source": c.sender_source,
        "total": c.total, "sent": c.sent_count, "failed": c.failed_count, "skipped": c.skipped_count, "pending": pending,
        "last_error": c.last_error, "created_by": c.created_by,
        "created_at": _iso(c.created_at), "started_at": _iso(c.started_at), "completed_at": _iso(c.completed_at),
    }


def _recipient_dict(r: EmailCampaignRecipient) -> dict:
    return {
        "id": r.id, "row_number": r.row_number, "email": r.email, "name": r.name, "company": r.company,
        "status": r.status, "error": r.error, "subject": r.subject, "body": r.body, "sent_at": _iso(r.sent_at),
        "sent_email_id": r.sent_email_id, "lead_id": r.lead_id, "client_id": r.client_id, "follow_up_id": r.follow_up_id,
        "data": r.data or {},
    }


@router.get("/email-campaigns/sender")
def campaign_sender(v: inbox.Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    return company_mailer.account_status(session, v.user.id, _tenant_of(v))


@router.post("/email-campaigns/parse")
async def parse_campaign_file(file: UploadFile = File(...), v: inbox.Viewer = Depends(get_viewer)):
    data = await file.read(worker.MAX_FILE_BYTES + 1)
    try:
        parsed = worker.parse_upload(file.filename or "", data)
    except worker.UploadError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"filename": file.filename, **parsed}


class Mapping(BaseModel):
    email: Optional[str] = None
    name: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    company: Optional[str] = None


class TemplateBody(BaseModel):
    columns: List[str] = Field(max_length=200)
    rows: List[dict] = Field(max_length=5000)
    mapping: Mapping
    subject: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1, max_length=20000)
    ai_personalize: bool = False
    ai_instructions: Optional[str] = Field(default=None, max_length=2000)


def _validate_template(body: TemplateBody):
    if not body.mapping.email or body.mapping.email not in body.columns:
        raise HTTPException(status_code=400, detail="Choose which column holds the email address.")
    for field, col in body.mapping.model_dump().items():
        if col and col not in body.columns:
            raise HTTPException(status_code=400, detail=f"The {field.replace('_', ' ')} column “{col}” is not in the file.")
    unknown = worker.unknown_placeholders([body.subject, body.body], body.columns)
    if unknown:
        raise HTTPException(status_code=400, detail="Unknown placeholder(s): " + ", ".join("{{" + u + "}}" for u in unknown)
                            + ". Use a column name from the file, or one of {{name}}, {{first_name}}, {{company}}, {{email}}.")


def _rows(body: TemplateBody) -> list:
    """Rows as plain {column: str} dicts, restricted to the uploaded columns."""
    return [{c: str(r.get(c, "") if r.get(c) is not None else "").strip()[:2000] for c in body.columns}
            for r in body.rows[: worker.max_rows()]]


def _sender_identity(session: Session, v: inbox.Viewer) -> tuple:
    from database import EmailAgentProfile
    prof = session.exec(select(EmailAgentProfile).where(EmailAgentProfile.user_id == v.user.id)
                        .execution_options(skip_tenant=True)).first()
    tenant = session.get(Tenant, _tenant_of(v)) if _tenant_of(v) else None
    return ((prof.agent_name if prof else None) or v.user.name or ""), ((tenant.business_name or tenant.name) if tenant else "")


class PreviewBody(TemplateBody):
    count: int = Field(default=3, ge=1, le=10)
    start: int = Field(default=0, ge=0)


@router.post("/email-campaigns/preview")
def preview_campaign(body: PreviewBody, v: inbox.Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    _validate_template(body)
    rows = _rows(body)
    mapping = body.mapping.model_dump()
    statuses = worker.classify_rows(rows, mapping)
    sendable = [s for s in statuses if s[2] == "Pending"]
    sender_name, company = _sender_identity(session, v)
    signature = company_mailer.user_signature(session, v.user.id)
    fake = EmailCampaign(name="preview", subject_template=body.subject, body_template=body.body, mapping=mapping,
                         ai_personalize=body.ai_personalize, ai_instructions=body.ai_instructions)
    ai_on = body.ai_personalize and bool(os.getenv("OPENAI_API_KEY"))
    if ai_on:
        inbox._charge_trial(session, v, "emails")
    inbox._release(session)
    previews, missing_rows = [], 0
    for row_number, row, _, _ in sendable:
        ctx = worker.row_context(row, mapping, sender_name)
        _, m1 = worker.render(body.subject, ctx)
        _, m2 = worker.render(body.body, ctx)
        if m1 or m2:
            missing_rows += 1
    for row_number, row, _, _ in sendable[body.start: body.start + body.count]:
        ctx = worker.row_context(row, mapping, sender_name)
        _, m1 = worker.render(body.subject, ctx)
        _, m2 = worker.render(body.body, ctx)
        subject, text, note = worker.compose(fake, row, sender_name, company, ai=ai_on)
        previews.append({
            "row_number": row_number, "email": row.get(mapping["email"], ""), "name": ctx.get("name"),
            "company": ctx.get("company"), "subject": subject, "body": company_mailer.apply_signature(text, signature),
            "missing": sorted(set(m1 + m2)), "note": note,
        })
    return {
        "previews": previews, "sendable": len(sendable), "rows_with_missing_values": missing_rows,
        "skipped": [{"row_number": n, "email": r.get(mapping["email"], "") if mapping.get("email") else "", "reason": why}
                    for n, r, st, why in statuses if st == "Skipped"][:200],
        "ai_personalized": ai_on, "ai_available": bool(os.getenv("OPENAI_API_KEY")),
    }


class CreateBody(TemplateBody):
    name: Optional[str] = Field(default=None, max_length=255)
    source_filename: Optional[str] = Field(default=None, max_length=255)
    create_leads: bool = True
    followup_days: Optional[int] = Field(default=None, ge=1, le=90)


@router.post("/email-campaigns")
def create_campaign(body: CreateBody, v: inbox.Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    _validate_template(body)
    tenant_id = _tenant_of(v)
    try:
        account = company_mailer.resolve_account(session, v.user.id, tenant_id)
    except company_mailer.MailAccountError as e:
        raise HTTPException(status_code=503, detail=str(e))
    rows = _rows(body)
    mapping = body.mapping.model_dump()
    statuses = worker.classify_rows(rows, mapping)
    sendable = sum(1 for s in statuses if s[2] == "Pending")
    if not sendable:
        raise HTTPException(status_code=400, detail="No row has a valid email address — nothing to send.")

    # Demo trial: every email counts toward the tenant's trial email allowance.
    if v.user.role == "Demo" and tenant_id:
        tenant = session.get(Tenant, tenant_id)
        if tenant and tenant.is_trial:
            remaining = max(0, tenant.limit_emails - tenant.usage_emails)
            if sendable > remaining:
                raise HTTPException(status_code=403, detail={"error": "LIMIT_REACHED", "limit_type": "emails",
                                                             "message": f"Trial limit reached. You can send {remaining} more email(s)."})
            tenant.usage_emails += sendable
            session.add(tenant)

    name = (body.name or "").strip() or (os.path.splitext(body.source_filename or "")[0] or "Email campaign")
    c = EmailCampaign(
        tenant_id=tenant_id, name=name[:255], source_filename=body.source_filename, columns=body.columns,
        mapping=mapping, subject_template=body.subject.strip(), body_template=body.body,
        ai_personalize=body.ai_personalize, ai_instructions=(body.ai_instructions or "").strip() or None,
        create_leads=body.create_leads, followup_days=body.followup_days, created_by=v.user.id,
        sender_email=account.email, sender_source=account.source, status="Queued",
    )
    session.add(c)
    session.flush()
    sender_name, _ = _sender_identity(session, v)
    for row_number, row, status, reason in statuses:
        ctx = worker.row_context(row, mapping, sender_name)
        session.add(EmailCampaignRecipient(
            tenant_id=tenant_id, campaign_id=c.id, row_number=row_number,
            email=(ctx["email"] or "(none)")[:255], name=(ctx["name"] or None) and ctx["name"][:255],
            company=(ctx["company"] or None) and ctx["company"][:255], data=row, status=status, error=reason,
        ))
    session.flush()
    worker.refresh_counts(session, c)
    session.commit()
    session.refresh(c)
    worker.start_campaign(c.id)
    return {"campaign": _campaign_dict(c),
            "message": f"Sending {sendable} personalized email(s) from {account.email}."}


@router.get("/email-campaigns")
def list_campaigns(limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0),
                   v: inbox.Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    items = session.exec(_scope(select(EmailCampaign), v).order_by(EmailCampaign.created_at.desc())
                         .offset(offset).limit(limit)).all()
    return {"items": [_campaign_dict(c) for c in items]}


@router.get("/email-campaigns/{campaign_id}")
def get_campaign(campaign_id: int, status: Optional[str] = None, q: Optional[str] = Query(None, max_length=200),
                 limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0),
                 v: inbox.Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    c = _load(session, v, campaign_id)
    stmt = select(EmailCampaignRecipient).where(EmailCampaignRecipient.campaign_id == c.id)
    if status:
        stmt = stmt.where(EmailCampaignRecipient.status == status)
    if q and q.strip():
        from sqlalchemy import func, or_
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(EmailCampaignRecipient.email).like(like),
                              func.lower(func.coalesce(EmailCampaignRecipient.name, "")).like(like),
                              func.lower(func.coalesce(EmailCampaignRecipient.company, "")).like(like)))
    recipients = session.exec(stmt.order_by(EmailCampaignRecipient.row_number).offset(offset).limit(limit)).all()
    return {"campaign": _campaign_dict(c), "recipients": [_recipient_dict(r) for r in recipients]}


@router.get("/email-campaigns/{campaign_id}/export")
def export_campaign(campaign_id: int, v: inbox.Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    c = _load(session, v, campaign_id)
    rows = session.exec(select(EmailCampaignRecipient).where(EmailCampaignRecipient.campaign_id == c.id)
                        .order_by(EmailCampaignRecipient.row_number)).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Row", "Recipient email", "Name", "Company", "Status", "Sent at (UTC)", "Subject", "Error / note"])
    for r in rows:
        w.writerow([r.row_number, r.email, r.name or "", r.company or "", r.status,
                    _iso(r.sent_at) or "", r.subject or "", r.error or ""])
    filename = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in c.name)[:60] or "campaign"
    return StreamingResponse(iter(["﻿" + buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{filename}-send-record.csv"'})


@router.post("/email-campaigns/{campaign_id}/cancel")
def cancel_campaign(campaign_id: int, v: inbox.Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    c = _load(session, v, campaign_id)
    if c.status not in ("Queued", "Sending"):
        raise HTTPException(status_code=400, detail=f"This campaign is already {c.status.lower()}.")
    c.status = "Cancelled"
    c.completed_at = worker.utcnow()
    worker.refresh_counts(session, c)
    session.commit()
    session.refresh(c)
    return {"campaign": _campaign_dict(c)}


@router.post("/email-campaigns/{campaign_id}/retry")
def retry_campaign(campaign_id: int, v: inbox.Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    c = _load(session, v, campaign_id)
    if c.status in ("Queued", "Sending"):
        raise HTTPException(status_code=400, detail="This campaign is still sending.")
    try:  # the worker sends as the campaign's creator, so check their account
        account = company_mailer.resolve_account(session, c.created_by, c.tenant_id)
    except company_mailer.MailAccountError as e:
        raise HTTPException(status_code=503, detail=str(e))
    failed = session.exec(select(EmailCampaignRecipient).where(
        EmailCampaignRecipient.campaign_id == c.id, EmailCampaignRecipient.status == "Failed")).all()
    pending = session.exec(select(EmailCampaignRecipient.id).where(
        EmailCampaignRecipient.campaign_id == c.id, EmailCampaignRecipient.status == "Pending")).first()
    if not failed and not pending:
        raise HTTPException(status_code=400, detail="There are no failed or unsent emails to retry.")
    for r in failed:
        r.status, r.error, r.claimed_at = "Pending", None, None
        session.add(r)
    c.status, c.completed_at, c.last_error = "Sending", None, None
    c.sender_email, c.sender_source = account.email, account.source
    worker.refresh_counts(session, c)
    session.commit()
    session.refresh(c)
    worker.start_campaign(c.id)
    return {"campaign": _campaign_dict(c), "requeued": len(failed)}
