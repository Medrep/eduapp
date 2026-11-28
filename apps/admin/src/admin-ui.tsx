import { useId, useLayoutEffect, useRef, useState } from "react";

// Outline paths from the approved Admin v1.0 icon set.
const paths = {
  book: "M3 4H9Q12 4 12 7V20Q9 17 3 18Z M21 4H15Q12 4 12 7V20Q15 17 21 18Z",
  grid: "M3 3H10V10H3Z M14 3H21V10H14Z M3 14H10V21H3Z M14 14H21V21H14Z",
  users: "M3 21V18Q3 14 9 14Q15 14 15 18V21 M16 14Q21 14 21 18V21 M9 11A4 4 0 1 0 9 3A4 4 0 1 0 9 11 M17 4Q22 7 17 11",
  logout: "M10 4H4V20H10 M9 12H21 M17 8L21 12L17 16",
  refresh: "M20 8A9 9 0 1 0 21 14 M20 3V9H14",
  plus: "M12 5V19 M5 12H19",
  search: "M15 15L21 21 M10 17A7 7 0 1 0 10 3A7 7 0 1 0 10 17",
  file: "M5 3H14L19 8V21H5Z M14 3V8H19",
  back: "M10 5L3 12L10 19 M3 12H21",
  check: "M5 12L10 17L20 7",
};

export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

export function Brand({ heading }: { heading: React.Ref<HTMLHeadingElement> }) {
  return <div className="admin-brand">
    <img src="/icons/bright-pages.svg" width="36" height="36" alt="" />
    <div>
      <h1 ref={heading} aria-label="Panel administratora" tabIndex={-1}>Moja Nauka</h1>
      <p>Panel administratora</p>
    </div>
  </div>;
}

type Confirmation = { title: string; detail: string; label: string; action: () => void; danger?: boolean };

export function useConfirmation() {
  const id = useId();
  const [pending, setPending] = useState<Confirmation>();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (pending) {
      dialog.current?.showModal();
      cancel.current?.focus();
    }
  }, [pending]);
  const close = () => {
    dialog.current?.close();
    setPending(undefined);
  };
  return {
    confirm: setPending,
    dialog: pending && <dialog className="admin-confirm" ref={dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-detail`}
      onCancel={event => { event.preventDefault(); close(); }}>
      <h3 id={`${id}-title`}>{pending.title}</h3>
      <p id={`${id}-detail`}>{pending.detail}</p>
      <div className="toolbar confirm-actions">
        <button type="button" ref={cancel} onClick={close}>Anuluj</button>
        <button type="button" className={pending.danger ? "danger" : "primary"} onClick={() => {
          close();
          pending.action();
        }}>{pending.label}</button>
      </div>
    </dialog>,
  };
}
