// src/modules/reports/i18n.js — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.


// ── Report language (2026-10-30) ─────────────────────────────────────────────
// PDF / print headings in English, Hinglish (Hindi in Latin letters) or
// Gujlish (Gujarati in Latin letters), so the shop floor and the owner read
// the same report in the words they use. Column names are translated the
// same way; anything not in the table stays in English.
export const REPORT_LANGS = [["en", "English"], ["hinglish", "Hinglish"], ["gujlish", "Gujlish"]];

export const REPORT_T = {
  hinglish: {
    "Report": "Report", "Date": "Tarikh", "Machine": "Machine", "Serial": "Serial No.", "Model": "Model",
    "Department": "Vibhag", "From": "Kahan se", "To": "Kahan tak", "Status": "Sthiti", "Completed": "Poora hua",
    "Active": "Chalu", "Pending": "Baaki", "Total machines": "Kul machine", "Avg rating": "Ausat rating",
    "Delayed handovers": "Der se transfer", "Held handovers": "Hold par transfer", "Open pending items": "Baaki kaam (khule)",
    "Resolved pending items": "Baaki kaam (poore)", "Took longer than allowed": "Tay samay se zyada laga",
    "Accepted late — the next department left it waiting": "Der se sweekar — agla vibhag intezaar karata raha",
    "Issues raised and still open": "Uthaye gaye masle jo abhi khule hain", "Department ratings": "Vibhag rating",
    "Customer Progress Report": "Grahak Pragati Report", "Every handover, in full": "Har transfer, poora vivaran",
    "Target": "Lakshya samay", "Actual": "Vastavik samay", "Delay": "Deri", "Reason": "Kaaran", "Part": "Part", "Qty": "Matra",
    "Reported": "Darj kiya", "Part received": "Part mila", "Work completed": "Kaam poora", "Printed on": "Print tarikh",
    "Prepared by": "Taiyar kiya", "CurrentStage": "Abhi ka charan", "CompletedOn": "Poora hone ki tarikh", "StagesCompleted": "Poore charan",
    "Description": "Vivaran", "ReportedReason": "Darj kaaran", "ReceiveRemark": "Milne par tippani", "ResolutionNotes": "Poora hone ki tippani",
    "ResponsibleDepartment": "Zimmedar vibhag", "RaisedInDepartment": "Kis vibhag me uthaya", "RaisedAt": "Kab uthaya",
    "HeldMin": "Hold minute", "OverrunMin": "Deri minute", "ExpectedMin": "Lakshya minute", "ActualMin": "Vastavik minute",
  },
  gujlish: {
    "Report": "Report", "Date": "Tarikh", "Machine": "Machine", "Serial": "Serial No.", "Model": "Model",
    "Department": "Vibhag", "From": "Kyanthi", "To": "Kya sudhi", "Status": "Sthiti", "Completed": "Puru thayu",
    "Active": "Chalu", "Pending": "Baki", "Total machines": "Kul machine", "Avg rating": "Sarerash rating",
    "Delayed handovers": "Modu transfer", "Held handovers": "Hold par transfer", "Open pending items": "Baki kaam (khulla)",
    "Resolved pending items": "Baki kaam (pura)", "Took longer than allowed": "Nakki samay karta vadhu lagyo",
    "Accepted late — the next department left it waiting": "Modu swikaryu — pachhina vibhage rah jovdavi",
    "Issues raised and still open": "Uthavela prashno je haju khulla chhe", "Department ratings": "Vibhag rating",
    "Customer Progress Report": "Grahak Pragati Report", "Every handover, in full": "Dar transfer, puri vigat",
    "Target": "Lakshya samay", "Actual": "Kharekhar samay", "Delay": "Modu", "Reason": "Karan", "Part": "Part", "Qty": "Jaththo",
    "Reported": "Nondhyu", "Part received": "Part malyo", "Work completed": "Kaam puru", "Printed on": "Print tarikh",
    "Prepared by": "Taiyar karnar", "CurrentStage": "Atyarno tabakko", "CompletedOn": "Pura thavani tarikh", "StagesCompleted": "Pura thayela tabakka",
    "Description": "Vigat", "ReportedReason": "Nondhelu karan", "ReceiveRemark": "Malya parni nondh", "ResolutionNotes": "Pura thaya parni nondh",
    "ResponsibleDepartment": "Javabdar vibhag", "RaisedInDepartment": "Kya vibhag ma uthavyu", "RaisedAt": "Kyare uthavyu",
    "HeldMin": "Hold minute", "OverrunMin": "Modu minute", "ExpectedMin": "Lakshya minute", "ActualMin": "Kharekhar minute",
  },
};

export const rt = (lang, key) => (REPORT_T[lang] && REPORT_T[lang][key]) || key;
