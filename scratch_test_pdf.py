import io, os
from datetime import datetime, timedelta
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, Flowable, KeepTogether, HRFlowable
)
from reportlab.pdfgen import canvas
from pypdf import PdfReader

def _number_to_words(n):
    units = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
             "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
    tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]
    
    def _helper(num):
        if num == 0:
            return ""
        elif num < 20:
            return units[num] + " "
        elif num < 100:
            return tens[num // 10] + ("-" + units[num % 10] if num % 10 != 0 else "") + " "
        elif num < 1000:
            return units[num // 100] + " Hundred " + _helper(num % 100)
        elif num < 1000000:
            return _helper(num // 1000) + " Thousand " + _helper(num % 1000)
        elif num < 1000000000:
            return _helper(num // 1000000) + " Million " + _helper(num % 1000000)
        else:
            return _helper(num // 1000000000) + " Billion " + _helper(num % 1000000000)

    try:
        val = int(round(float(n)))
        if val <= 0:
            return "Zero"
        return " ".join(_helper(val).split())
    except Exception:
        return ""

def _format_date(dt):
    if not dt:
        return ""
    if hasattr(dt, "strftime"):
        return dt.strftime("%B %d, %Y")
    s = str(dt)
    try:
        parsed = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return parsed.strftime("%B %d, %Y")
    except Exception:
        return s[:10]

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_footer(num_pages)
            super().showPage()
        super().save()

    def draw_footer(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 7)
        self.setFillColor(colors.HexColor("#64748b"))
        # Top dividing line
        self.setStrokeColor(colors.HexColor("#cbd5e1"))
        self.setLineWidth(0.5)
        self.line(14 * mm, 12 * mm, A4[0] - 14 * mm, 12 * mm)
        
        # Left brand
        self.drawString(14 * mm, 8 * mm, "SCM BPO (Division of SCM SHIPPING SERVICES PVT LTD) · Koyenco Techpark, Infopark, Kakkanad, Cochin")
        self.drawString(14 * mm, 5 * mm, "Confidential Commercial Quotation · contact@scmbpo.com · www.scmbpo.com")
        
        # Right page number
        page_str = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(A4[0] - 14 * mm, 8 * mm, page_str)
        self.restoreState()


def generate_scmbpo_quote_pdf(data):
    """Generate an executive-grade commercial proposal / quotation PDF for SCM BPO."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=7 * mm,
        bottomMargin=11 * mm,
    )
    story = []

    # Palette
    c_navy = colors.HexColor("#0f172a")       # primary slate navy
    c_blue = colors.HexColor("#1d4ed8")       # corporate accent
    c_dark = colors.HexColor("#1e293b")       # table header
    c_text = colors.HexColor("#334155")       # body text
    c_muted = colors.HexColor("#64748b")      # secondary labels
    c_card_bg = colors.HexColor("#f8fafc")    # info box bg
    c_card_border = colors.HexColor("#e2e8f0")
    c_accent_border = colors.HexColor("#93c5fd")

    def S(name, font="Helvetica", size=8.5, leading=11, color=c_text, bold=False, align=TA_LEFT):
        return ParagraphStyle(
            name,
            fontName="Helvetica-Bold" if bold else font,
            fontSize=size,
            leading=leading,
            textColor=color,
            alignment=align,
            spaceBefore=0,
            spaceAfter=0,
            wordWrap="CJK",
        )

    # 1. Resolve Data
    company_name = "SCM BPO"
    legal_name = "SCM SHIPPING SERVICES PVT LTD"
    address_line = "Koyenco Techpark, Kepip, Infopark P.O., Kakkanad, Cochin - 682042"
    contact_phone = "+91-9947950099"
    contact_email = "contact@scmbpo.com"
    website = "www.scmbpo.com"

    qn = data.get("quote_number") or f"Q-{data.get('id', '0001')}"
    title = data.get("title") or "Commercial Quotation & Proposal"
    status = (data.get("status") or "Draft").strip()
    currency = str(data.get("currency") or "MXN").upper()
    curr_sym = "₹" if currency == "INR" else ("$" if currency in ("USD", "MXN", "CAD", "AUD") else f"{currency} ")

    created_dt = data.get("created_at") or datetime.now()
    created_str = _format_date(created_dt)
    
    valid_until = data.get("valid_until")
    if valid_until:
        valid_str = _format_date(valid_until)
    else:
        try:
            base_dt = created_dt if isinstance(created_dt, datetime) else datetime.fromisoformat(str(created_dt)[:19])
            valid_str = (base_dt + timedelta(days=30)).strftime("%B %d, %Y")
        except Exception:
            valid_str = "30 Days from Issue"

    client_company = data.get("client_company") or data.get("client_name") or "Valued Client"
    client_name = data.get("client_name") or client_company
    client_email = data.get("client_email") or ""
    client_phone = data.get("client_phone") or ""
    client_address = data.get("client_address") or ""

    st_upper = status.upper()
    if st_upper in ("ACCEPTED", "PAID", "APPROVED"):
        badge_fg = colors.HexColor("#15803d")
    elif st_upper in ("SENT", "PENDING", "IN REVIEW"):
        badge_fg = colors.HexColor("#1d4ed8")
    else:
        badge_fg = colors.HexColor("#b45309")

    # ── HEADER BLOCK ──────────────────────────────────────────────────────────
    logo_path = "static/logo.png"
    logo_cell = None
    if os.path.exists(logo_path):
        try:
            logo_cell = Image(logo_path, width=36 * mm, height=18.5 * mm)
            logo_cell.hAlign = "LEFT"
        except Exception:
            logo_cell = None

    company_lines = [
        Paragraph(f"<b>{company_name}</b>", S("cName", font="Helvetica-Bold", size=14, leading=16, color=c_navy, bold=True)),
        Paragraph(f"<b>{legal_name}</b>", S("cLeg", size=8, leading=10, color=c_blue, bold=True)),
        Paragraph("Logistics Back-Office & Business Process Outsourcing (BPO)", S("cTag", size=7, leading=9, color=c_muted)),
        Paragraph(address_line, S("cAddr", size=7, leading=9, color=c_muted)),
        Paragraph(f"Tel: {contact_phone}  |  Email: {contact_email}  |  Web: {website}", S("cCont", size=7, leading=9, color=c_muted)),
    ]

    left_header = Table(
        [[logo_cell, Table([[p] for p in company_lines], colWidths=[68 * mm])]] if logo_cell else
        [[Table([[p] for p in company_lines], colWidths=[106 * mm])]],
        colWidths=[38 * mm, 68 * mm] if logo_cell else [106 * mm]
    )
    left_header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))

    meta_box = [
        Paragraph("COMMERCIAL QUOTATION", S("qHead", font="Helvetica-Bold", size=12, leading=14, color=c_navy, bold=True, align=TA_RIGHT)),
        Paragraph(f"<font color='#0284c7'><b>#{qn}</b></font>", S("qNum", font="Helvetica-Bold", size=10, leading=12, align=TA_RIGHT)),
        Spacer(1, 1 * mm),
        Paragraph(f"<b>Date:</b> {created_str}", S("qD1", size=7.5, leading=9.5, color=c_text, align=TA_RIGHT)),
        Paragraph(f"<b>Valid Until:</b> {valid_str}", S("qD2", size=7.5, leading=9.5, color=c_text, align=TA_RIGHT)),
        Paragraph(f"<b>Currency:</b> {currency}", S("qD3", size=7.5, leading=9.5, color=c_text, align=TA_RIGHT)),
        Spacer(1, 1 * mm),
        Paragraph(f"<font color='{badge_fg.hexval()}'><b>[ STATUS: {st_upper} ]</b></font>", S("qSt", size=7.5, leading=9.5, bold=True, align=TA_RIGHT)),
    ]
    right_meta_table = Table([[p] for p in meta_box], colWidths=[72 * mm])
    right_meta_table.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
        ("BACKGROUND", (0, 0), (-1, -1), c_card_bg),
        ("BOX", (0, 0), (-1, -1), 0.5, c_card_border),
    ]))

    header_table = Table([[left_header, right_meta_table]], colWidths=[108 * mm, 74 * mm])
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 1.5 * mm))

    story.append(HRFlowable(width="100%", thickness=1.5, color=c_blue, spaceBefore=0, spaceAfter=1.5))
    story.append(HRFlowable(width="100%", thickness=0.5, color=c_card_border, spaceBefore=0, spaceAfter=2.5 * mm))

    # ── CLIENT & COMMERCIAL PARTIES ──────────────────────────────────────────
    bill_lines = [
        Paragraph("<b>PREPARED FOR / CLIENT DETAILS:</b>", S("bHead", size=7.5, leading=9.5, color=c_blue, bold=True)),
        Paragraph(f"<b>{client_company}</b>", S("bName", font="Helvetica-Bold", size=9.5, leading=11.5, color=c_navy, bold=True)),
    ]
    if client_email:
        bill_lines.append(Paragraph(f"<b>Email:</b> {client_email}", S("bEm", size=7.5, leading=9.5, color=c_text)))
    if client_phone:
        bill_lines.append(Paragraph(f"<b>Phone:</b> {client_phone}", S("bPh", size=7.5, leading=9.5, color=c_text)))
    if client_address:
        bill_lines.append(Paragraph(f"<b>Address:</b> {client_address}", S("bAd", size=7.5, leading=9.5, color=c_text)))
    bill_lines.append(Paragraph(f"<b>Project Scope:</b> {title}", S("bScope", size=7.5, leading=9.5, color=c_text)))

    prov_lines = [
        Paragraph("<b>ISSUED BY & COMMERCIAL DESK:</b>", S("pHead", size=7.5, leading=9.5, color=c_blue, bold=True)),
        Paragraph("<b>SCM BPO Commercial Operations</b>", S("pName", font="Helvetica-Bold", size=9.5, leading=11.5, color=c_navy, bold=True)),
        Paragraph(f"<b>Legal Entity:</b> {legal_name}", S("pLeg", size=7.5, leading=9.5, color=c_text)),
        Paragraph("<b>Representative:</b> Noushad C I (Founder & MD)", S("pRep", size=7.5, leading=9.5, color=c_text)),
        Paragraph(f"<b>Operations:</b> {contact_email}  |  24/7 Operations Desk", S("pOp", size=7.5, leading=9.5, color=c_text)),
        Paragraph("<b>Facility:</b> Koyenco Techpark, Infopark, Cochin, India", S("pFac", size=7.5, leading=9.5, color=c_text)),
    ]

    card_left = Table([[p] for p in bill_lines], colWidths=[88 * mm])
    card_left.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), c_card_bg),
        ("BOX", (0, 0), (-1, -1), 0.5, c_card_border),
        ("LEFTPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
    ]))

    card_right = Table([[p] for p in prov_lines], colWidths=[88 * mm])
    card_right.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), c_card_bg),
        ("BOX", (0, 0), (-1, -1), 0.5, c_card_border),
        ("LEFTPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
    ]))

    parties_table = Table([[card_left, card_right]], colWidths=[91 * mm, 91 * mm])
    parties_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(parties_table)
    story.append(Spacer(1, 1.8 * mm))

    # ── ITEMS TABLE ──────────────────────────────────────────────────────────
    items = data.get("items") or []
    grand_total = float(data.get("grand_total") or 0.0)

    if not items:
        svc_title = title if title and title != "—" else "Logistics Back-Office & Commercial Operations"
        items = [
            {
                "description": (
                    f"<b>{svc_title}</b><br/>"
                    f"<font color='#64748b' size='7'>"
                    f"• End-to-end shipment data processing, documentation and freight invoice verification<br/>"
                    f"• 24/7 dedicated dispatch operations coordination, tracking and milestone updates<br/>"
                    f"• Customs documentation compliance, manifest generation and carrier communications<br/>"
                    f"• Dedicated account supervisory workflow with 99.8% on-time turnaround SLA"
                    f"</font>"
                ),
                "unit": "Retainer Scope",
                "quantity": 1,
                "unit_price": grand_total,
                "total": grand_total,
            }
        ]

    col_widths = [8 * mm, 90 * mm, 24 * mm, 14 * mm, 23 * mm, 23 * mm]
    headers = ["#", "Deliverable & Scope of Work", "Service Unit", "Qty", f"Rate ({currency})", f"Amount ({currency})"]

    table_data = [[
        Paragraph(f"<b>{h}</b>", S(f"th_{i}", font="Helvetica-Bold", size=7.5, leading=9.5, color=colors.white, bold=True,
                                  align=TA_CENTER if i in (0, 3) else (TA_RIGHT if i in (4, 5) else TA_LEFT)))
        for i, h in enumerate(headers)
    ]]

    calc_subtotal = 0.0
    for idx, itm in enumerate(items, 1):
        desc = itm.get("description") or "Service Deliverable"
        unit_str = str(itm.get("unit") or "Scope")
        qty = float(itm.get("quantity") or 1)
        rate = float(itm.get("unit_price") or 0)
        tot = float(itm.get("total") or (qty * rate))
        calc_subtotal += tot

        table_data.append([
            Paragraph(f"<font color='#64748b'>{idx}</font>", S(f"td_idx_{idx}", size=7.5, leading=10, align=TA_CENTER)),
            Paragraph(desc, S(f"td_desc_{idx}", size=7.5, leading=10, color=c_navy)),
            Paragraph(f"<font color='#64748b'>{unit_str}</font>", S(f"td_u_{idx}", size=7, leading=9, align=TA_LEFT)),
            Paragraph(f"{qty:g}", S(f"td_q_{idx}", size=7.5, leading=10, align=TA_CENTER)),
            Paragraph(f"{curr_sym}{rate:,.2f}", S(f"td_r_{idx}", size=7.5, leading=10, align=TA_RIGHT)),
            Paragraph(f"<b>{curr_sym}{tot:,.2f}</b>", S(f"td_t_{idx}", font="Helvetica-Bold", size=7.5, leading=10, color=c_navy, bold=True, align=TA_RIGHT)),
        ])

    final_subtotal = float(data.get("subtotal") or calc_subtotal)
    tax_rate = float(data.get("tax_rate") or 0.0)
    tax_amt = final_subtotal * (tax_rate / 100.0) if tax_rate > 0 else 0.0
    discount = float(data.get("discount") or 0.0)
    final_grand = float(data.get("grand_total") or (final_subtotal - discount + tax_amt))

    item_table_style = [
        ("BACKGROUND", (0, 0), (-1, 0), c_dark),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, 0), 2 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 2 * mm),
        ("TOPPADDING", (0, 1), (-1, -1), 2 * mm),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 2 * mm),
        ("LEFTPADDING", (0, 0), (-1, -1), 1.5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 1.5 * mm),
        ("LINEBELOW", (0, 0), (-1, 0), 1, c_blue),
    ]
    for r_idx in range(1, len(table_data)):
        bg = c_card_bg if r_idx % 2 == 0 else colors.white
        item_table_style.append(("BACKGROUND", (0, r_idx), (-1, r_idx), bg))
        item_table_style.append(("LINEBELOW", (0, r_idx), (-1, r_idx), 0.35, c_card_border))

    items_table = Table(table_data, colWidths=col_widths, repeatRows=1)
    items_table.setStyle(TableStyle(item_table_style))
    story.append(items_table)
    story.append(Spacer(1, 2 * mm))

    # ── TOTALS & WORDS ───────────────────────────────────────────────────────
    words = _number_to_words(final_grand)
    words_str = f"{words} {currency} Only" if words else ""

    words_cell = [
        Paragraph("<b>AMOUNT IN WORDS:</b>", S("wH", size=7, leading=9, color=c_muted, bold=True)),
        Paragraph(f"<i>{words_str}</i>", S("wVal", font="Helvetica-Bold", size=8, leading=10, color=c_navy, bold=True)),
        Spacer(1, 1 * mm),
        Paragraph("<b>TAX STATUS:</b> 0% Export of BPO Support Services / Reverse Charge Applicable",
                  S("wTax", size=6.5, leading=8.5, color=c_muted)),
    ]
    words_table = Table([[p] for p in words_cell], colWidths=[96 * mm])
    words_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), c_card_bg),
        ("BOX", (0, 0), (-1, -1), 0.5, c_card_border),
        ("LEFTPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5 * mm),
    ]))

    tot_rows = [
        [Paragraph("Subtotal", S("sL", size=7.5, leading=9.5, color=c_muted, align=TA_RIGHT)),
         Paragraph(f"{curr_sym}{final_subtotal:,.2f}", S("sV", size=7.5, leading=9.5, color=c_navy, align=TA_RIGHT))],
    ]
    if discount > 0:
        tot_rows.append([
            Paragraph("Discount", S("dL", size=7.5, leading=9.5, color=colors.HexColor("#dc2626"), align=TA_RIGHT)),
            Paragraph(f"-{curr_sym}{discount:,.2f}", S("dV", size=7.5, leading=9.5, color=colors.HexColor("#dc2626"), align=TA_RIGHT))
        ])
    tot_rows.append([
        Paragraph("Taxes (0% Export)", S("tL0", size=7, leading=9, color=c_muted, align=TA_RIGHT)),
        Paragraph(f"{curr_sym}0.00", S("tV0", size=7, leading=9, color=c_muted, align=TA_RIGHT))
    ])
    tot_rows.append([
        Paragraph("<b>TOTAL CONTRACT VALUE</b>", S("gL", font="Helvetica-Bold", size=8.5, leading=10.5, color=c_navy, bold=True, align=TA_RIGHT)),
        Paragraph(f"<b>{curr_sym}{final_grand:,.2f} {currency}</b>", S("gV", font="Helvetica-Bold", size=9.5, leading=11.5, color=c_blue, bold=True, align=TA_RIGHT))
    ])

    tot_table = Table(tot_rows, colWidths=[46 * mm, 36 * mm])
    tot_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 1 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1 * mm),
        ("LEFTPADDING", (0, 0), (-1, -1), 1 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 1 * mm),
        ("LINEABOVE", (0, -1), (-1, -1), 1, c_blue),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#eff6ff")),
        ("BOX", (0, -1), (-1, -1), 0.75, c_accent_border),
    ]))

    calc_wrapper = Table([[words_table, tot_table]], colWidths=[98 * mm, 84 * mm])
    calc_wrapper.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(calc_wrapper)
    story.append(Spacer(1, 1.5 * mm))

    # ── CAPABILITIES ─────────────────────────────────────────────────────────
    cap_data = [
        [
            Paragraph("<b>⚡ 99.8% On-Time Turnaround</b><br/><font color='#64748b' size='6.5'>Rigorous SLA adherence for shipment manifests, billing audits & customs data entries.</font>", S("cap1", size=7, leading=8.5)),
            Paragraph("<b>🔒 Enterprise Data Security</b><br/><font color='#64748b' size='6.5'>Strict NDA, ISO 27001 data security compliance and encrypted client portal infrastructure.</font>", S("cap2", size=7, leading=8.5)),
            Paragraph("<b>👥 Dedicated Operations Pod</b><br/><font color='#64748b' size='6.5'>Fully trained logistics specialists and account supervisors dedicated to your pipeline.</font>", S("cap3", size=7, leading=8.5)),
        ]
    ]
    cap_table = Table(cap_data, colWidths=[60 * mm, 61 * mm, 61 * mm])
    cap_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f1f5f9")),
        ("BOX", (0, 0), (-1, -1), 0.5, c_card_border),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5 * mm),
        ("LINEBEFORE", (1, 0), (1, -1), 0.5, c_card_border),
        ("LINEBEFORE", (2, 0), (2, -1), 0.5, c_card_border),
    ]))
    story.append(cap_table)
    story.append(Spacer(1, 1.5 * mm))

    # ── TERMS & BANKING ──────────────────────────────────────────────────────
    p_terms = data.get("payment_terms") or "Net 30 days upon formal invoice issuance via Bank Wire Transfer."
    c_notes = data.get("notes") or ""
    
    terms_content = [
        Paragraph("<b>COMMERCIAL TERMS & PAYMENT INSTRUCTIONS:</b>", S("tHead", size=7.5, leading=9.5, color=c_blue, bold=True)),
        Paragraph(f"• <b>Payment Terms:</b> {p_terms}", S("t1", size=7, leading=8.5, color=c_text)),
        Paragraph("• <b>Remittance Partner:</b> Direct Wire / ACH to Beneficiary: <b>SCM SHIPPING SERVICES PVT LTD</b>.", S("t2", size=7, leading=8.5, color=c_text)),
        Paragraph("• <b>Banking Coordinates:</b> Full SWIFT/IFSC & Account details are specified on official tax invoices.", S("t3", size=7, leading=8.5, color=c_text)),
        Paragraph("• <b>Governing Agreement:</b> SCM BPO Standard Master Services Terms & Operational SLAs apply.", S("t4", size=7, leading=8.5, color=c_text)),
    ]
    if c_notes and c_notes.strip():
        terms_content.append(Spacer(1, 0.5 * mm))
        terms_content.append(Paragraph(f"• <b>Client Notes & Specifications:</b> {c_notes.strip()}", S("tNotes", size=7, leading=8.5, color=c_text)))

    terms_box = Table([[p] for p in terms_content], colWidths=[182 * mm])
    terms_box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), c_card_bg),
        ("BOX", (0, 0), (-1, -1), 0.5, c_card_border),
        ("LEFTPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5 * mm),
    ]))
    story.append(terms_box)
    story.append(Spacer(1, 1.5 * mm))

    # ── SIGNATURES ───────────────────────────────────────────────────────────
    signed_at = data.get("signed_at")
    
    left_sign = [
        Paragraph("<b>AUTHORIZED SIGNATORY (SCM BPO)</b>", S("sHeadL", size=7.5, leading=9.5, color=c_blue, bold=True)),
        Spacer(1, 1 * mm),
        Paragraph("<b>Noushad C I</b>", S("sNameL", font="Helvetica-Bold", size=8.5, leading=10.5, color=c_navy, bold=True)),
        Paragraph("Founder & Managing Director", S("sRoleL", size=7, leading=8.5, color=c_muted)),
        Paragraph(legal_name, S("sLegL", size=7, leading=8.5, color=c_muted)),
        Spacer(1, 1 * mm),
        Paragraph("<font color='#059669'><b>[ SEALED & DIGITALLY VERIFIED BY SCM BPO ]</b></font>", S("sSeal", size=6.5, leading=8.5, bold=True)),
    ]
    sign_box_left = Table([[p] for p in left_sign], colWidths=[88 * mm])
    sign_box_left.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), c_card_bg),
        ("BOX", (0, 0), (-1, -1), 0.5, c_card_border),
        ("LEFTPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
    ]))

    if signed_at or st_upper in ("ACCEPTED", "APPROVED"):
        signed_date_str = _format_date(signed_at) if signed_at else created_str
        right_sign = [
            Paragraph("<b>CLIENT ACCEPTANCE & APPROVAL</b>", S("sHeadR", size=7.5, leading=9.5, color=colors.HexColor("#15803d"), bold=True)),
            Spacer(1, 1 * mm),
            Paragraph("<b>✓ DIGITALLY ACCEPTED & CONFIRMED</b>", S("sAccR", font="Helvetica-Bold", size=8.5, leading=10.5, color=colors.HexColor("#15803d"), bold=True)),
            Paragraph(f"<b>Authorized For:</b> {client_company}", S("sCliR", size=7, leading=8.5, color=c_navy)),
            Paragraph(f"<b>Execution Timestamp:</b> {signed_date_str}", S("sDateR", size=7, leading=8.5, color=c_muted)),
            Paragraph("<b>Verification:</b> Authenticated via SCM BPO Secure Client Portal", S("sVerR", size=6.5, leading=8.5, color=c_muted)),
        ]
        sign_box_right = Table([[p] for p in right_sign], colWidths=[88 * mm])
        sign_box_right.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f0fdf4")),
            ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#86efac")),
            ("LEFTPADDING", (0, 0), (-1, -1), 2.5 * mm),
            ("RIGHTPADDING", (0, 0), (-1, -1), 2.5 * mm),
            ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
        ]))
    else:
        right_sign = [
            Paragraph("<b>CLIENT ACCEPTANCE & AUTHORIZATION</b>", S("sHeadR", size=7.5, leading=9.5, color=c_blue, bold=True)),
            Spacer(1, 1 * mm),
            Paragraph("Authorized Signature: ____________________________", S("sLine1", size=7.5, leading=10, color=c_muted)),
            Paragraph("Name & Title: _________________________________", S("sLine2", size=7.5, leading=10, color=c_muted)),
            Paragraph(f"Organization: <b>{client_company}</b>", S("sLine3", size=7, leading=9, color=c_text)),
            Paragraph("Date of Signing: _______________________________", S("sLine4", size=7.5, leading=10, color=c_muted)),
        ]
        sign_box_right = Table([[p] for p in right_sign], colWidths=[88 * mm])
        sign_box_right.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), c_card_bg),
            ("BOX", (0, 0), (-1, -1), 0.5, c_card_border),
            ("LEFTPADDING", (0, 0), (-1, -1), 2.5 * mm),
            ("RIGHTPADDING", (0, 0), (-1, -1), 2.5 * mm),
            ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
        ]))

    sign_wrapper = Table([[sign_box_left, sign_box_right]], colWidths=[91 * mm, 91 * mm])
    sign_wrapper.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(sign_wrapper)

    doc.build(story, canvasmaker=NumberedCanvas)
    return buf.getvalue()

if __name__ == "__main__":
    from sqlmodel import Session
    from database import engine, Proposal, ClientProfile, User
    with Session(engine) as session:
        prop = session.get(Proposal, 4)
        c = session.get(ClientProfile, prop.client_id)
        u = session.get(User, c.userId) if c and c.userId else None
        
        pdf = generate_scmbpo_quote_pdf({
            "id": prop.id,
            "quote_number": f"Q-{prop.id:04d}",
            "title": prop.title,
            "status": prop.status,
            "client_name": c.companyName if c else "SerpHawk",
            "client_company": c.companyName if c else "SerpHawk",
            "client_email": u.email if u else "info@serphawk.com",
            "client_phone": c.phone if c else "+1 (555) 234-5678",
            "client_address": c.address if c else "Mexico City, Mexico",
            "currency": prop.currency or "MXN",
            "items": prop.line_items or [],
            "grand_total": prop.total_value or 25000.0,
            "created_at": prop.created_at,
            "signed_at": prop.signed_at,
        })
        with open("new_premium_quote_output.pdf", "wb") as f:
            f.write(pdf)
        reader = PdfReader("new_premium_quote_output.pdf")
        print("Total pages:", len(reader.pages))
        for i, page in enumerate(reader.pages):
            print(f"Page {i+1} character count:", len(page.extract_text()))
