import { useConfirmation } from "./admin-ui.tsx";
import { useState, type FormEvent } from "react";
import {
  type AdminLesson, type AdminSubject, type Family, type LessonInput, type SubjectInput, type Visibility,
} from "../../../packages/contracts/src/admin.ts";

export const ownerFamilyId = "00000000-0000-4000-8000-000000000001";
export const lessonStatus = { draft: "Szkic", published: "Opublikowana", unpublished: "Ukryta" };

export function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleString("pl-PL") : "—";
}

export function formText(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function LessonForm({ lesson, subjects, families, busy, save, onDirty }: {
  lesson?: AdminLesson; subjects: AdminSubject[]; families: Family[]; busy: boolean; save: (input: LessonInput) => void; onDirty?: () => void;
}) {
  const confirmation = useConfirmation();
  const [scope, setScope] = useState<Visibility>(lesson?.visibility ?? "selected");
  const enabledFamilies = families.filter(family => family.enabled);
  const defaultFamilies = lesson?.familyIds ?? enabledFamilies.filter(family => family.id === ownerFamilyId).map(family => family.id);
  const [assignments, setAssignments] = useState(defaultFamilies);
  const selectableSubjects = subjects.filter(subject => !subject.archivedAt || subject.id === lesson?.subjectId);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const grade = formText(form, "grade");
    const input: LessonInput = {
      title: formText(form, "title"), subjectId: formText(form, "subjectId"),
      description: formText(form, "description") || null, grade: grade ? Number(grade) : null,
      visibility: scope, familyIds: scope === "all" ? [] : assignments,
    };
    if (scope === "all") confirmation.confirm({
      title: "Udostępnić wszystkim rodzinom?",
      detail: lesson?.status === "published"
        ? "Zmiana widoczności opublikowanej lekcji może dotrzeć do urządzeń po synchronizacji."
        : "Po publikacji lekcja będzie dostępna dla wszystkich aktywnych rodzin.",
      label: "Zapisz dla wszystkich rodzin", action: () => save(input),
    });
    else save(input);
  }

  return <><form onSubmit={submit} onChange={onDirty} className="stack-form lesson-form">
    <label>Tytuł<input name="title" required maxLength={120} defaultValue={lesson?.title ?? ""} /></label>
    <div className="lesson-fields"><label>Przedmiot<select name="subjectId" required defaultValue={lesson?.subjectId ?? ""}>
      <option value="">Wybierz przedmiot</option>
      {selectableSubjects.map(subject => <option key={subject.id} value={subject.id}>{subject.namePl}</option>)}
    </select></label>
    <label>Klasa (opcjonalnie)<select name="grade" defaultValue={lesson?.grade ?? ""}>
      <option value="">Bez oznaczenia</option>
      {[1, 2, 3, 4, 5, 6, 7, 8].map(grade => <option key={grade} value={grade}>{grade}</option>)}
    </select></label></div>
    <label>Opis (opcjonalnie)<textarea name="description" maxLength={500} defaultValue={lesson?.description ?? ""} /></label>
    <label>Udostępnij<select value={scope} onChange={event => setScope(event.target.value === "all" ? "all" : "selected")}>
      <option value="selected">Wybrane rodziny</option><option value="all">Wszystkie rodziny</option>
    </select></label>
    {scope === "selected" && <fieldset>
      <legend>Przypisane rodziny</legend>
      {enabledFamilies.map(family => <label key={family.id} className="checkbox">
        <input type="checkbox" checked={assignments.includes(family.id)} onChange={event => {
          const checked = event.target.checked;
          setAssignments(current => checked ? [...current, family.id] : current.filter(id => id !== family.id));
        }} />{family.label}
      </label>)}
      {!enabledFamilies.length && <p>Brak aktywnych rodzin.</p>}
    </fieldset>}
    <button type="submit" className="primary" disabled={busy || !selectableSubjects.length}>
      {lesson ? "Zapisz zmiany" : "Zapisz szkic"}
    </button>
  </form>{confirmation.dialog}</>;
}

export function SubjectForm({ subject, busy, save }: {
  subject?: AdminSubject; busy: boolean; save: (input: SubjectInput) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save({ namePl: formText(form, "namePl"), slug: subject?.slug ?? formText(form, "slug"), sortOrder: Number(formText(form, "sortOrder")) });
  }

  return <form onSubmit={submit} className="stack-form">
    <label>Nazwa przedmiotu<input name="namePl" maxLength={60} required defaultValue={subject?.namePl ?? ""} /></label>
    <label>Identyfikator URL<input name="slug" minLength={2} maxLength={50} required pattern="[a-z0-9\-]{2,50}"
      autoCapitalize="none" defaultValue={subject?.slug ?? ""} readOnly={Boolean(subject)} /></label>
    <label>Kolejność<input name="sortOrder" type="number" min={-2147483648} max={2147483647} step={1} required defaultValue={subject?.sortOrder ?? 0} /></label>
    <button type="submit" className="primary" disabled={busy}>{subject ? "Zapisz przedmiot" : "Dodaj przedmiot"}</button>
  </form>;
}
