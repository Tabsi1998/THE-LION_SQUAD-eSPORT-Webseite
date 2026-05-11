import { Link } from "react-router-dom";

const MENTION_PATTERN = /(^|[^A-Za-z0-9_.-])@([A-Za-z0-9_.-]{2,32})/g;

export function MentionText({ text = "" }) {
  const raw = String(text || "");
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = MENTION_PATTERN.exec(raw)) !== null) {
    const prefix = match[1] || "";
    const username = match[2];
    const mentionStart = match.index + prefix.length;
    if (mentionStart > lastIndex) parts.push(raw.slice(lastIndex, mentionStart));
    parts.push(
      <Link
        key={`${mentionStart}-${username}`}
        to={`/u/${encodeURIComponent(username)}`}
        className="font-bold text-[#29B6E8] hover:text-white"
      >
        @{username}
      </Link>,
    );
    lastIndex = mentionStart + username.length + 1;
  }

  if (lastIndex < raw.length) parts.push(raw.slice(lastIndex));
  return <>{parts}</>;
}
