import { useEffect, useRef, useState } from "react";
import { AtSign } from "lucide-react";
import { api, resolveMediaUrl } from "@/lib/api";

export function mentionTriggerAt(value, caret) {
  const before = String(value || "").slice(0, caret ?? 0);
  const match = /(^|[\s([{])@([A-Za-z0-9_.-]{0,32})$/.exec(before);
  if (!match) return null;
  const query = match[2] || "";
  return {
    query,
    from: before.length - query.length - 1,
    to: before.length,
  };
}

export function useMentionSearch(query, { scope, scopeId } = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const needle = String(query || "").trim();
    if (needle.length < 1) {
      setItems([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get("/users/mention-search", {
          params: { q: needle, scope, scope_id: scopeId },
        });
        setItems(Array.isArray(data) ? data : []);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    }, 160);
    return () => clearTimeout(timer);
  }, [query, scope, scopeId]);

  return { items, loading };
}

function userLabel(user) {
  return user?.display_name || user?.username || "Benutzer";
}

export function MentionSuggestionList({ items, activeIndex = 0, onPick, loading = false, className = "", style }) {
  if (!loading && (!items || items.length === 0)) return null;
  return (
    <div
      className={`z-40 w-full max-w-sm overflow-hidden rounded-sm border border-[#29B6E8]/40 bg-[#121212] shadow-2xl shadow-black/50 ${className}`}
      style={style}
      onMouseDown={(event) => event.preventDefault()}
      role="listbox"
    >
      {loading && <div className="px-3 py-2 text-xs text-white/40">Benutzer werden gesucht...</div>}
      {!loading && items.map((user, index) => (
        <button
          key={user.id}
          type="button"
          onClick={() => onPick(user)}
          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
            index === activeIndex ? "bg-[#29B6E8]/15 text-white" : "text-white/75 hover:bg-white/5"
          }`}
          role="option"
          aria-selected={index === activeIndex}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-white/10 bg-[#0A0A0A] text-[10px] font-bold uppercase text-[#29B6E8]">
            {user.avatar_url ? (
              <img src={resolveMediaUrl(user.avatar_url)} alt="" className="h-full w-full object-cover" />
            ) : (
              <AtSign className="h-3.5 w-3.5" />
            )}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-bold">{userLabel(user)}</span>
            <span className="block truncate text-xs text-white/40">@{user.username}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function getTextareaCaretPosition(textarea, caret) {
  if (!textarea || typeof document === "undefined") return { left: 0, top: 0 };
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  const properties = [
    "boxSizing", "width", "height", "overflowX", "overflowY", "borderTopWidth", "borderRightWidth",
    "borderBottomWidth", "borderLeftWidth", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "fontSizeAdjust", "lineHeight",
    "fontFamily", "textAlign", "textTransform", "textIndent", "textDecoration", "letterSpacing", "wordSpacing",
    "tabSize", "MozTabSize",
  ];
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  properties.forEach((prop) => {
    mirror.style[prop] = style[prop];
  });
  const before = textarea.value.slice(0, caret);
  const after = textarea.value.slice(caret) || ".";
  mirror.textContent = before;
  const marker = document.createElement("span");
  marker.textContent = after[0];
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.35 || 18;
  const left = marker.offsetLeft - textarea.scrollLeft;
  const top = marker.offsetTop - textarea.scrollTop + lineHeight;
  document.body.removeChild(mirror);
  return { left, top };
}

export function MentionTextarea({
  value = "",
  onValueChange,
  scope,
  scopeId,
  rows = 1,
  maxLength,
  placeholder,
  className = "",
  textareaClassName = "",
  onKeyDown,
  ...props
}) {
  const inputRef = useRef(null);
  const [trigger, setTrigger] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const [activeIndex, setActiveIndex] = useState(0);
  const { items, loading } = useMentionSearch(trigger?.query || "", { scope, scopeId });

  const refreshTrigger = () => {
    const input = inputRef.current;
    if (!input) return;
    const caret = input.selectionStart || 0;
    const next = mentionTriggerAt(input.value, caret);
    setTrigger(next);
    if (next) setMenuPosition(getTextareaCaretPosition(input, caret));
    setActiveIndex(0);
  };

  const emit = (nextValue) => {
    onValueChange?.(nextValue);
  };

  const insertMention = (user) => {
    if (!trigger) return;
    const input = inputRef.current;
    const next = `${String(value || "").slice(0, trigger.from)}@${user.username} ${String(value || "").slice(trigger.to)}`;
    const caret = trigger.from + user.username.length + 2;
    emit(next);
    setTrigger(null);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(caret, caret);
    });
  };

  const open = !!trigger && (loading || items.length > 0);

  return (
    <div className={`relative ${className}`}>
      <textarea
        ref={inputRef}
        value={value || ""}
        onChange={(event) => {
          emit(event.target.value);
          requestAnimationFrame(refreshTrigger);
        }}
        onClick={refreshTrigger}
        onKeyUp={refreshTrigger}
        onKeyDown={(event) => {
          if (open && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
            event.preventDefault();
            if (event.key === "Escape") {
              setTrigger(null);
              return;
            }
            if (event.key === "ArrowDown") {
              setActiveIndex((index) => Math.min(index + 1, Math.max(items.length - 1, 0)));
              return;
            }
            if (event.key === "ArrowUp") {
              setActiveIndex((index) => Math.max(index - 1, 0));
              return;
            }
            if (items[activeIndex]) insertMention(items[activeIndex]);
            return;
          }
          onKeyDown?.(event);
        }}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        className={textareaClassName}
        {...props}
      />
      {open && (
        <MentionSuggestionList
          items={items}
          loading={loading}
          activeIndex={activeIndex}
          onPick={insertMention}
          className="absolute"
          style={{ left: menuPosition.left, top: menuPosition.top + 4 }}
        />
      )}
    </div>
  );
}
