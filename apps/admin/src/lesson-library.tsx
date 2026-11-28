import { useState } from "react";
import type { AdminLesson, AdminSubject, Family } from "../../../packages/contracts/src/admin.ts";
import { Icon } from "./admin-ui.tsx";
import { lessonStatus } from "./owner-forms.tsx";

export function LessonLibrary({ lessons, subjects, families, busy, visible, edit, create }: {
  lessons: AdminLesson[]; subjects: AdminSubject[]; families: Family[]; busy: boolean; visible: boolean;
  edit: (id: string) => void; create: () => void;
}) {
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("recent");
  const search = query.trim().toLocaleLowerCase("pl");
  const rows = lessons.filter(item => (!subject || item.subjectId === subject) && (!status || item.status === status) &&
    item.title.toLocaleLowerCase("pl").includes(search)).sort((a, b) =>
      (sort === "recent" ? Date.parse(b.updatedAt) - Date.parse(a.updatedAt) : 0) ||
      a.title.localeCompare(b.title, "pl") || a.id.localeCompare(b.id));
  const subjectNames = new Map(subjects.map(entry => [entry.id, entry.namePl]));
  const filtered = Boolean(search || subject || status);

  return <section>
    <div className="page-heading library-heading">
      <div><h2 id={visible ? "admin-view-heading" : undefined} tabIndex={-1}>Lekcje</h2><p>Zarządzaj materiałami dostępnymi dla dzieci.</p></div>
      <button type="button" className="primary" onClick={create} disabled={busy}><Icon name="plus" />Nowa lekcja</button>
    </div>
    <div className="library-filters">
      <label className="search-field"><span className="sr-only">Szukaj lekcji</span><Icon name="search" />
        <input type="search" placeholder="Szukaj lekcji" value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      <label><select aria-label="Przedmiot" value={subject} onChange={event => setSubject(event.target.value)}>
        <option value="">Wszystkie przedmioty</option>
        {subjects.map(item => <option key={item.id} value={item.id}>{item.namePl}</option>)}
      </select></label>
      <label><select aria-label="Status" value={status} onChange={event => setStatus(event.target.value)}>
        <option value="">Wszystkie stany</option>
        {Object.entries(lessonStatus).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label><select aria-label="Sortowanie" value={sort} onChange={event => setSort(event.target.value)}>
        <option value="recent">Najnowsze zmiany</option><option value="title">Tytuł A–Z</option>
      </select></label>
    </div>
    <p className="library-count" role="status">Liczba lekcji: {rows.length}</p>
    {rows.length > 0 ? <table className="lesson-table" aria-label="Biblioteka lekcji" role="table">
      <thead role="rowgroup"><tr role="row">
        {["Tytuł", "Przedmiot", "Klasa", "Status", "Aktywna wersja", "Rodziny", "Działania"].map((label,index) =>
          <th scope="col" role="columnheader" key={label}>{index < 6 ? label : <span className="sr-only">{label}</span>}</th>)}
      </tr></thead>
      <tbody role="rowgroup">{rows.map(item => <tr role="row" key={item.id}>
        <th scope="row" role="rowheader" className="lesson-cell-title"><h3>{item.title}</h3></th>
        <td role="cell" className="lesson-cell-subject">{subjectNames.get(item.subjectId) ?? "Przedmiot niedostępny"}</td>
        <td role="cell" className="lesson-cell-grade"><span className="only-narrow">Klasa </span>{item.grade ?? "—"}</td>
        <td role="cell" className="lesson-cell-status"><span className={`badge ${item.status}`}>{lessonStatus[item.status]}</span></td>
        <td role="cell" className="lesson-cell-version"><span className="only-narrow">Aktywna wersja: </span>
          {item.status === "published" && item.activeVersionId ? `${item.activeVersionId.slice(0, 8)}…` : "—"}
        </td>
        <td role="cell" className="lesson-cell-families"><span className="only-narrow">Rodziny: </span>
          {item.visibility === "all" ? "Wszystkie rodziny" : families.filter(family => item.familyIds.includes(family.id))
            .map(family => family.label).join(", ") || "Brak przypisanych rodzin"}
        </td>
        <td role="cell" className="lesson-cell-action"><button type="button" aria-label={`Edytuj lekcję: ${item.title}`} disabled={busy}
          onClick={() => edit(item.id)}>Edytuj</button></td>
      </tr>)}</tbody>
    </table> : <div className="panel empty-state">
      <h3>{filtered ? "Nie ma lekcji pasujących do wyszukiwania." : "Nie ma jeszcze lekcji."}</h3>
      {filtered && <button type="button" onClick={() => { setQuery(""); setSubject(""); setStatus(""); }}>Wyczyść filtry</button>}
    </div>}
  </section>;
}
