'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

/** Follow-ups live in one section now: /follow-ups, whose "Email follow-ups" tab is this old page.
 *  Keeps old links (notifications, bookmarks, ?view=today) working. */
export default function FollowupsRedirect() {
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('tab', 'email');
    router.replace(`/follow-ups?${params.toString()}`);
  }, [router]);

  return (
    <div className="flex justify-center py-16"><Loader2 className="animate-spin text-slate-400" /></div>
  );
}
