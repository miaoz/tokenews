import { useEffect, useId, useRef } from "react";
import { X } from "@phosphor-icons/react";
import { referenceTags } from "./domain";
import type { Row } from "./types";
export default function Modal({
  title,
  children,
  onClose,
  wide = false,
  closeLabel = "Close",
  evidenceRows = [],
  lang = "en",
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  closeLabel?: string;
  evidenceRows?: Row[];
  lang?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const el = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    el?.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      el?.close();
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      className={wide ? "modal wide" : "modal"}
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        close.current();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            close.current();
        }
      }}
      aria-labelledby={headingId}
    >
      <div className="modal-head">
        <h2 id={headingId}>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label={closeLabel}
        >
          <X size={18} />
        </button>
      </div>
      <div className="modal-body">
        {referenceTags(evidenceRows, lang).length > 0 && <div className="reference-qualifiers detail-qualifiers">
          {referenceTags(evidenceRows, lang).map(tag => <span key={tag}>{tag}</span>)}
          <p>{lang === "zh" ? "价格与评测配置仅作参考关联，并非该套餐的联合实测。" : "Price and benchmark configurations are references, not a joint measurement of this plan."}</p>
        </div>}
        {children}
      </div>
    </dialog>
  );
}
