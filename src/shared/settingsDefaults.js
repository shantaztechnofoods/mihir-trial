// src/shared/settingsDefaults.js — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.


export const SETTINGS_DEFAULTS = {
  companyName:     "SHANTA G TECHNOFOODS LLP", // 2026-11-04 — the one legal name (reports v2)
  gst:             "",
  address:         "",
  phone:           "",
  email:           "",
  logo:            "",
  currency:        "INR (₹)",
  whatsappAlerts:  false,
  emailAlerts:     false,
  // WhatsApp Business API (Chakra HQ) integration
  waApiKey:        "",     // Chakra HQ Bearer token
  waPhoneId:       "",     // WhatsApp phone number ID
  waWabaId:        "",     // WhatsApp Business Account ID — needed to create templates
  waOwnerPhone:    "",     // Owner's phone for admin alerts (with country code, e.g. 919876543210)
  waNotifyIssue:   true,   // Notify when issue raised on machine
  waNotifyTransfer:true,   // Notify when machine transferred to next dept
  waNotifyDeadline:true,   // Notify when dept exceeds time limit
  waNotifyDaily:   false,  // Daily morning summary
  waGroupNumbers:  "",     // Comma-separated dept head phone numbers
  po:              null,   // Purchase Order settings (company profiles, templates) — see utils/poTemplate
  employeeMembers: [],     // [{ id, name, active, departments: string[] }] — display names for factory workers without ERP logins
  // 2026-10-30 — Report Settings (admin only): what every printed / PDF report carries.
  report: { language: "en", showLogo: true, companyLine: "", footerNote: "", includeTestRecords: false,
            // 2026-10-31 — signature / stamp image (data URL), page layout, displayed fields.
            signatureImage: "", signatureLabel: "Authorised Signatory", pageSize: "A4", orientation: "portrait",
            showEmployees: true, showChecklists: true, showRatings: true, showPendingJobs: true },
};
