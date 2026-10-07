/**
 * The notification template library: every message the platform can send, with its ID (APT-001…), who receives it,
 * which channels it may use, which are on by default, the tokens it can use and its default English wording.
 *
 * One source for three places:
 *  - the hospital app (Settings → Notifications): `scope: 'hospital'` events — the owner turns channels on/off and may
 *    reword them (unless the platform team locked the template);
 *  - the control panel (Messaging → Templates): every event — the platform team edits the default wording, switches an
 *    event or a channel off for every hospital, locks templates, adds custom templates and exports the WhatsApp sheet;
 *  - the database: scripts/build-master-sql.ts writes this list into public.notify_catalog() (scripts/sql/notify_catalog.sql).
 *
 * The wording of the 17 original events lives in src/settings/types.ts (DEFAULT_TEMPLATES, unchanged so saved settings
 * keep matching); everything else is here. src/notify/index.ts joins the two.
 */
import type { OriginalEvent } from '../settings/types'

/** 'inapp' = the bell inside the app (public.user_notifications) — free, needs no provider */
export type EvChannel = 'sms' | 'whatsapp' | 'email' | 'push' | 'inapp'
export const EV_CHANNELS: EvChannel[] = ['sms', 'whatsapp', 'email', 'push', 'inapp']
export const EV_CHANNEL_LABEL: Record<EvChannel, string> = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email', push: 'Push', inapp: 'In-app' }

/** patient · doctor · reception (receptionists) · staff (any team member) · owner (hospital owner) · team (platform team) · any (whoever the account belongs to) */
export type Audience = 'patient' | 'doctor' | 'reception' | 'staff' | 'owner' | 'team' | 'any'
export const AUDIENCE_LABEL: Record<Audience, string> = {
  patient: 'Patient', doctor: 'Doctor', reception: 'Reception', staff: 'Staff', owner: 'Hospital owner', team: 'Platform team', any: 'Account holder',
}

/**
 * hospital       — a hospital event: the hospital chooses channels / may reword it (Settings → Notifications)
 * platform_owner — sent by the platform to a hospital's owner (billing, account status): only the control panel edits it
 * platform       — an alert to the platform team (control panel → Alerts): only the control panel edits it
 */
export type Scope = 'hospital' | 'platform_owner' | 'platform'

export type WaCategory = 'UTILITY' | 'AUTHENTICATION' | 'MARKETING'

export type Group = 'AUTH' | 'STF' | 'PAT' | 'APT' | 'ADM' | 'RX' | 'LAB' | 'BIL' | 'PRV' | 'HSP' | 'SUB' | 'TEN' | 'SYS'
export const GROUP_LABEL: Record<Group, string> = {
  AUTH: 'Sign-in & accounts', STF: 'Team & leave', PAT: 'Patients', APT: 'Appointments', ADM: 'Admissions (IPD)', RX: 'Prescriptions',
  LAB: 'Lab', BIL: 'Billing', PRV: 'Privacy', HSP: 'Hospital owner', SUB: 'Subscription & wallet', TEN: 'Hospital account', SYS: 'Platform alerts',
}

export interface CatalogCopy {
  subject: string
  /** SMS text and e-mail body */
  text: string
  /** WhatsApp wording (*bold*, emoji); empty = text */
  waText?: string
  /** push / in-app line (title = subject); empty = text */
  pushText?: string
  /** suggested WhatsApp template parameters, in order */
  waParams?: string
}

export interface CatalogEntry {
  id: string
  code: string
  group: Group
  scope: Scope
  audience: Audience
  label: string
  /** when it goes out */
  hint: string
  channels: EvChannel[]
  defaults: Partial<Record<EvChannel, boolean>>
  tokens: string[]
  waCategory: WaCategory
  /** default wording (the 17 original events take theirs from DEFAULT_TEMPLATES) */
  copy?: CatalogCopy
  /** the body is written by whoever sends it (security notice): only the subject and the switches can be changed */
  freeText?: boolean
}

/** hospital events added with the template library (the original 17 are in NotifyEvent too) */
export type NewHospitalEvent =
  | 'new_device_signin' | 'staff_joined' | 'leave_requested' | 'leave_approved' | 'leave_rejected'
  | 'patient_registered' | 'patient_birthday'
  | 'appointment_confirmed' | 'appointment_checked_in' | 'appointment_no_show' | 'doctor_unavailable' | 'followup_reminder'
  | 'doctor_new_appointment' | 'doctor_daily_schedule' | 'online_booking_alert'
  | 'admission_created' | 'bed_transferred' | 'patient_discharged' | 'doctor_new_admission'
  | 'prescription_issued' | 'lab_test_ordered' | 'lab_result_doctor'
  | 'invoice_balance_due' | 'invoice_cancelled' | 'invoice_overdue'
  | 'privacy_request_resolved' | 'owner_daily_digest'

const P: EvChannel[] = ['sms', 'whatsapp', 'email', 'push', 'inapp']    // a patient / any person
const TEAM: EvChannel[] = ['whatsapp', 'email', 'push', 'inapp']           // hospital staff (no SMS cost by default)
const OWNER: EvChannel[] = ['sms', 'whatsapp', 'email', 'push', 'inapp']
const on = (...c: EvChannel[]) => Object.fromEntries(c.map((x) => [x, true])) as Partial<Record<EvChannel, boolean>>

/** metadata for the 17 original events (their wording + default switches stay in src/settings/types.ts) */
export const ORIGINAL_META: Record<OriginalEvent, Pick<CatalogEntry, 'code' | 'group' | 'audience' | 'waCategory'> & { inapp?: boolean }> = {
  otp: { code: 'AUTH-001', group: 'AUTH', audience: 'patient', waCategory: 'AUTHENTICATION' },
  password_otp: { code: 'AUTH-002', group: 'AUTH', audience: 'any', waCategory: 'AUTHENTICATION' },
  login_otp: { code: 'AUTH-003', group: 'AUTH', audience: 'any', waCategory: 'AUTHENTICATION' },
  account_created: { code: 'AUTH-004', group: 'AUTH', audience: 'any', waCategory: 'UTILITY', inapp: true },
  account_updated: { code: 'AUTH-005', group: 'AUTH', audience: 'any', waCategory: 'UTILITY', inapp: true },
  account_deleted: { code: 'AUTH-006', group: 'AUTH', audience: 'any', waCategory: 'UTILITY' },
  password_changed: { code: 'AUTH-007', group: 'AUTH', audience: 'any', waCategory: 'UTILITY', inapp: true },
  staff_invite: { code: 'AUTH-009', group: 'AUTH', audience: 'staff', waCategory: 'UTILITY' },
  notice_published: { code: 'STF-005', group: 'STF', audience: 'staff', waCategory: 'UTILITY', inapp: true },
  appointment_booked: { code: 'APT-001', group: 'APT', audience: 'patient', waCategory: 'UTILITY', inapp: true },
  appointment_reminder: { code: 'APT-003', group: 'APT', audience: 'patient', waCategory: 'UTILITY', inapp: true },
  appointment_rescheduled: { code: 'APT-004', group: 'APT', audience: 'patient', waCategory: 'UTILITY', inapp: true },
  appointment_cancelled: { code: 'APT-005', group: 'APT', audience: 'patient', waCategory: 'UTILITY', inapp: true },
  feedback_request: { code: 'APT-008', group: 'APT', audience: 'patient', waCategory: 'MARKETING' },
  invoice_created: { code: 'BIL-001', group: 'BIL', audience: 'patient', waCategory: 'UTILITY', inapp: true },
  payment_received: { code: 'BIL-002', group: 'BIL', audience: 'patient', waCategory: 'UTILITY', inapp: true },
  lab_report_ready: { code: 'LAB-002', group: 'LAB', audience: 'patient', waCategory: 'UTILITY', inapp: true },
}

const NAME = ['name', 'hospital', 'hospital_phone']

/** the new hospital events — wording, channels and default switches */
export const NEW_HOSPITAL_EVENTS: (CatalogEntry & { id: NewHospitalEvent })[] = [
  // ---------------------------------------------------------------- sign-in
  { id: 'new_device_signin', code: 'AUTH-008', group: 'AUTH', scope: 'hospital', audience: 'any', label: 'Sign-in from a new device',
    hint: 'Someone signed in to the account from a browser or phone not seen before', channels: ['email', 'push', 'inapp'], defaults: on('email', 'push', 'inapp'),
    tokens: ['name', 'device', 'time', 'link', 'hospital', 'hospital_phone'], waCategory: 'UTILITY',
    copy: { subject: 'New sign-in to your {hospital} account', text: 'Hi {name}, your {hospital} account was just signed in on {device} ({time}). If this was you, nothing to do. Not you? Change your password now: {link}',
      pushText: 'New sign-in on {device}. Not you? Change your password.', waParams: 'name,device,time' } },
  // ---------------------------------------------------------------- team & leave
  { id: 'staff_joined', code: 'STF-001', group: 'STF', scope: 'hospital', audience: 'owner', label: 'Team member joined',
    hint: 'An invited team member created their account', channels: TEAM, defaults: on('email', 'push', 'inapp'),
    tokens: ['name', 'member', 'role', 'link', 'hospital'], waCategory: 'UTILITY',
    copy: { subject: '{member} joined {hospital}', text: 'Hi {name}, {member} accepted your invitation and joined {hospital} as {role}. Manage the team: {link}',
      pushText: '{member} joined as {role}.', waParams: 'name,member,role' } },
  { id: 'leave_requested', code: 'STF-002', group: 'STF', scope: 'hospital', audience: 'owner', label: 'Doctor leave requested',
    hint: 'A doctor asks for leave or blocks time (needs approval)', channels: TEAM, defaults: on('email', 'push', 'inapp'),
    tokens: ['name', 'doctor', 'kind', 'from', 'to', 'reason', 'link', 'hospital'], waCategory: 'UTILITY',
    copy: { subject: 'Leave request: {doctor}, {from} – {to}', text: 'Hi {name}, {doctor} asked for {kind} from {from} to {to}. Reason: {reason}. Approve or reject: {link}',
      pushText: '{doctor}: {kind} {from} – {to}. Tap to review.', waParams: 'name,doctor,kind,from,to' } },
  { id: 'leave_approved', code: 'STF-003', group: 'STF', scope: 'hospital', audience: 'doctor', label: 'Leave approved',
    hint: 'The doctor\'s leave request is approved', channels: P, defaults: on('email', 'push', 'inapp'),
    tokens: ['name', 'kind', 'from', 'to', 'hospital'], waCategory: 'UTILITY',
    copy: { subject: 'Your leave is approved ({from} – {to})', text: 'Hi {name}, your {kind} from {from} to {to} is approved. Patients booked in that time will be told. {hospital}',
      pushText: 'Your {kind} {from} – {to} is approved.', waParams: 'name,kind,from,to' } },
  { id: 'leave_rejected', code: 'STF-004', group: 'STF', scope: 'hospital', audience: 'doctor', label: 'Leave rejected',
    hint: 'The doctor\'s leave request is rejected', channels: P, defaults: on('email', 'push', 'inapp'),
    tokens: ['name', 'kind', 'from', 'to', 'hospital', 'hospital_phone'], waCategory: 'UTILITY',
    copy: { subject: 'Your leave request was not approved', text: 'Hi {name}, your {kind} request for {from} to {to} was not approved. Please talk to the hospital office. {hospital}',
      pushText: 'Your {kind} request {from} – {to} was not approved.', waParams: 'name,kind,from,to' } },
  // ---------------------------------------------------------------- patients
  { id: 'patient_registered', code: 'PAT-001', group: 'PAT', scope: 'hospital', audience: 'patient', label: 'Patient registered',
    hint: 'A new patient record is created (desk, website or WhatsApp)', channels: P, defaults: on('whatsapp', 'email', 'inapp'),
    tokens: ['name', 'mrn', 'link', ...NAME, 'address'], waCategory: 'UTILITY',
    copy: { subject: 'Welcome to {hospital}', text: 'Welcome to {hospital}, {name}. Your patient ID (MRN) is {mrn} — please quote it on every visit. Questions? Call {hospital_phone}.',
      waText: '🏥 *Welcome to {hospital}*\n\nHi {name}, your patient ID is *{mrn}*.\nPlease quote it on every visit.\n\n📍 {address}\n📞 {hospital_phone}', waParams: 'name,mrn' } },
  { id: 'patient_birthday', code: 'PAT-002', group: 'PAT', scope: 'hospital', audience: 'patient', label: 'Birthday wishes',
    hint: 'On the patient\'s birthday, 9 am (marketing — off by default)', channels: ['sms', 'whatsapp', 'email'], defaults: {},
    tokens: ['name', 'hospital'], waCategory: 'MARKETING',
    copy: { subject: 'Happy birthday, {name}!', text: 'Happy birthday, {name}! Wishing you good health and a wonderful year ahead. — {hospital}',
      waText: '🎂 *Happy birthday, {name}!*\n\nWishing you good health and a wonderful year ahead.\n— {hospital}', waParams: 'name' } },
  // ---------------------------------------------------------------- appointments
  { id: 'appointment_confirmed', code: 'APT-002', group: 'APT', scope: 'hospital', audience: 'patient', label: 'Appointment confirmed by the desk',
    hint: 'Reception marks a booked appointment as confirmed', channels: P, defaults: on('whatsapp', 'inapp'),
    tokens: ['name', 'doctor', 'date', 'time', 'ref', ...NAME], waCategory: 'UTILITY',
    copy: { subject: 'Confirmed: {date} at {time}', text: 'Hi {name}, {hospital} has confirmed your appointment with {doctor} on {date} at {time}. Ref {ref}. {hospital_phone}',
      waText: '👍 *Confirmed by the hospital*\n\nHi {name}, see you on *{date} at {time}* with {doctor}.\n🔖 Ref: {ref}\n— {hospital}', waParams: 'name,doctor,date,time' } },
  { id: 'appointment_checked_in', code: 'APT-006', group: 'APT', scope: 'hospital', audience: 'patient', label: 'Checked in',
    hint: 'The patient is checked in at the reception', channels: P, defaults: on('inapp', 'push'),
    tokens: ['name', 'doctor', 'time', 'hospital'], waCategory: 'UTILITY',
    copy: { subject: 'You are checked in', text: 'Hi {name}, you are checked in for {doctor}. Please wait — we will call you shortly. {hospital}',
      pushText: 'Checked in for {doctor}. We will call you shortly.', waParams: 'name,doctor' } },
  { id: 'appointment_no_show', code: 'APT-007', group: 'APT', scope: 'hospital', audience: 'patient', label: 'Missed appointment',
    hint: 'The appointment is marked as no-show', channels: P, defaults: on('sms', 'whatsapp', 'inapp'),
    tokens: ['name', 'doctor', 'date', 'time', 'link', ...NAME], waCategory: 'UTILITY',
    copy: { subject: 'We missed you today', text: 'Hi {name}, we missed you for your appointment with {doctor} on {date} at {time}. Book a new time: {link} or call {hospital_phone}. {hospital}',
      waText: '🕐 *We missed you*\n\nHi {name}, you could not make it to {doctor} on {date} at {time}.\nBook again: {link}\n📞 {hospital_phone}\n— {hospital}', waParams: 'name,doctor,date,time' } },
  { id: 'doctor_unavailable', code: 'APT-009', group: 'APT', scope: 'hospital', audience: 'patient', label: 'Doctor unavailable',
    hint: 'A doctor\'s leave is approved — every patient booked in that time is told', channels: P, defaults: on('sms', 'whatsapp', 'email', 'inapp'),
    tokens: ['name', 'doctor', 'date', 'time', 'ref', ...NAME], waCategory: 'UTILITY',
    copy: { subject: '{doctor} is not available on {date}', text: 'Hi {name}, {doctor} is not available on {date}, so your {time} appointment (ref {ref}) needs a new time. Please call {hospital_phone} to reschedule. Sorry for the trouble. {hospital}',
      waText: '⚠️ *Your appointment needs a new time*\n\nHi {name}, {doctor} is not available on *{date}*.\nYour {time} visit (ref {ref}) must be moved.\n\n📞 Call {hospital_phone} or reply *1* to book again.\n— {hospital}', waParams: 'name,doctor,date,time,ref' } },
  { id: 'followup_reminder', code: 'APT-010', group: 'APT', scope: 'hospital', audience: 'patient', label: 'Follow-up due',
    hint: 'The day before the follow-up date on a prescription (8 am)', channels: P, defaults: on('sms', 'whatsapp', 'inapp'),
    tokens: ['name', 'doctor', 'date', 'link', ...NAME], waCategory: 'UTILITY',
    copy: { subject: 'Follow-up with {doctor} tomorrow', text: 'Hi {name}, {doctor} asked to see you again tomorrow, {date}. Book your follow-up: {link} or call {hospital_phone}. {hospital}',
      waText: '🩺 *Follow-up due*\n\nHi {name}, {doctor} asked to see you again on *{date}*.\nBook: {link}\n📞 {hospital_phone}\n— {hospital}', waParams: 'name,doctor,date' } },
  { id: 'doctor_new_appointment', code: 'APT-011', group: 'APT', scope: 'hospital', audience: 'doctor', label: 'New appointment (to the doctor)',
    hint: 'An appointment is booked with the doctor', channels: TEAM, defaults: on('push', 'inapp'),
    tokens: ['name', 'patient', 'date', 'time', 'type', 'source', 'ref', 'hospital'], waCategory: 'UTILITY',
    copy: { subject: 'New appointment: {patient}, {date} {time}', text: 'Hi {name}, {patient} booked a {type} with you on {date} at {time} ({source}). Ref {ref}.',
      pushText: '{patient} · {date} {time} · {type}', waParams: 'name,patient,date,time' } },
  { id: 'doctor_daily_schedule', code: 'APT-012', group: 'APT', scope: 'hospital', audience: 'doctor', label: 'Doctor\'s day schedule',
    hint: 'Every morning at 7:30 — today\'s appointments (only when there are some)', channels: TEAM, defaults: on('email', 'inapp'),
    tokens: ['name', 'date', 'count', 'first_time', 'list', 'hospital'], waCategory: 'UTILITY',
    copy: { subject: 'Today: {count} appointments, first at {first_time}', text: 'Good morning {name}. You have {count} appointments today ({date}), the first at {first_time}:\n{list}\n— {hospital}',
      pushText: '{count} appointments today, first at {first_time}.', waParams: 'name,count,first_time' } },
  { id: 'online_booking_alert', code: 'APT-013', group: 'APT', scope: 'hospital', audience: 'reception', label: 'Online booking (to reception)',
    hint: 'A booking arrives from the website, patient portal or WhatsApp bot', channels: TEAM, defaults: on('push', 'inapp'),
    tokens: ['name', 'patient', 'doctor', 'date', 'time', 'source', 'ref', 'hospital'], waCategory: 'UTILITY',
    copy: { subject: 'New {source} booking: {patient}', text: 'New {source} booking: {patient} with {doctor} on {date} at {time}. Ref {ref}.',
      pushText: '{patient} → {doctor}, {date} {time}', waParams: 'patient,doctor,date,time' } },
  // ---------------------------------------------------------------- admissions
  { id: 'admission_created', code: 'ADM-001', group: 'ADM', scope: 'hospital', audience: 'patient', label: 'Admitted',
    hint: 'The patient is admitted (IPD)', channels: P, defaults: on('whatsapp', 'inapp'),
    tokens: ['name', 'ward', 'bed', 'doctor', 'date', ...NAME], waCategory: 'UTILITY',
    copy: { subject: 'Admission at {hospital}', text: 'Hi {name}, you are admitted at {hospital} on {date}: {ward}, bed {bed}, under {doctor}. Family can call {hospital_phone}.',
      waText: '🛏 *Admission details*\n\n{name}\n🏥 {ward}, bed *{bed}*\n🩺 {doctor}\n🗓 {date}\n\nFamily enquiries: {hospital_phone}\n— {hospital}', waParams: 'name,ward,bed,doctor' } },
  { id: 'bed_transferred', code: 'ADM-002', group: 'ADM', scope: 'hospital', audience: 'patient', label: 'Bed / ward changed',
    hint: 'An admitted patient moves to another bed', channels: P, defaults: on('inapp'),
    tokens: ['name', 'ward', 'bed', ...NAME], waCategory: 'UTILITY',
    copy: { subject: 'Moved to {ward}, bed {bed}', text: 'Hi {name}, you have been moved to {ward}, bed {bed}. {hospital} {hospital_phone}', waParams: 'name,ward,bed' } },
  { id: 'patient_discharged', code: 'ADM-003', group: 'ADM', scope: 'hospital', audience: 'patient', label: 'Discharged',
    hint: 'The admission is closed (discharge)', channels: P, defaults: on('whatsapp', 'email', 'inapp'),
    tokens: ['name', 'date', 'doctor', 'link', ...NAME], waCategory: 'UTILITY',
    copy: { subject: 'Discharged from {hospital}', text: 'Hi {name}, you were discharged on {date}. Please follow {doctor}\'s advice and come back if anything worries you. Your records: {link}. {hospital} {hospital_phone}',
      waText: '🏡 *Get well soon, {name}*\n\nYou were discharged on {date}.\nPlease follow {doctor}\'s advice.\nRecords: {link}\n📞 {hospital_phone}\n— {hospital}', waParams: 'name,date,doctor' } },
  { id: 'doctor_new_admission', code: 'ADM-004', group: 'ADM', scope: 'hospital', audience: 'doctor', label: 'New admission (to the doctor)',
    hint: 'A patient is admitted under the doctor', channels: TEAM, defaults: on('push', 'inapp'),
    tokens: ['name', 'patient', 'ward', 'bed', 'reason', 'hospital'], waCategory: 'UTILITY',
    copy: { subject: 'Admitted under you: {patient}', text: 'Hi {name}, {patient} was admitted under you — {ward}, bed {bed}. Reason: {reason}.',
      pushText: '{patient} · {ward} bed {bed}', waParams: 'name,patient,ward,bed' } },
  // ---------------------------------------------------------------- prescriptions & lab
  { id: 'prescription_issued', code: 'RX-001', group: 'RX', scope: 'hospital', audience: 'patient', label: 'Prescription ready',
    hint: 'A doctor writes a prescription', channels: P, defaults: on('whatsapp', 'email', 'inapp'),
    tokens: ['name', 'doctor', 'diagnosis', 'follow_up', 'link', ...NAME], waCategory: 'UTILITY',
    copy: { subject: 'Your prescription from {doctor}', text: 'Hi {name}, {doctor} has written your prescription ({diagnosis}). Follow-up: {follow_up}. View or download it: {link}. {hospital}',
      waText: '💊 *Prescription ready*\n\nHi {name}, {doctor} has written your prescription.\n📋 {diagnosis}\n🗓 Follow-up: {follow_up}\n\nView: {link}\n— {hospital}', waParams: 'name,doctor,follow_up' } },
  { id: 'lab_test_ordered', code: 'LAB-001', group: 'LAB', scope: 'hospital', audience: 'patient', label: 'Lab test ordered',
    hint: 'A lab test is requested for the patient', channels: P, defaults: on('inapp'),
    tokens: ['name', 'test', 'priority', ...NAME], waCategory: 'UTILITY',
    copy: { subject: '{test} ordered', text: 'Hi {name}, {test} has been ordered for you ({priority}). Please visit the lab counter. {hospital}', waParams: 'name,test' } },
  { id: 'lab_result_doctor', code: 'LAB-003', group: 'LAB', scope: 'hospital', audience: 'doctor', label: 'Lab result ready (to the doctor)',
    hint: 'A test the doctor ordered is completed', channels: TEAM, defaults: on('push', 'inapp'),
    tokens: ['name', 'patient', 'test', 'priority', 'hospital'], waCategory: 'UTILITY',
    copy: { subject: '{priority} result: {test} — {patient}', text: 'Hi {name}, the {test} result for {patient} ({priority}) is ready in the Lab module.',
      pushText: '{test} for {patient} is ready ({priority}).', waParams: 'name,test,patient' } },
  // ---------------------------------------------------------------- billing
  { id: 'invoice_balance_due', code: 'BIL-003', group: 'BIL', scope: 'hospital', audience: 'patient', label: 'Part payment — balance due',
    hint: 'A payment leaves a balance on the invoice', channels: P, defaults: on('email', 'inapp'),
    tokens: ['name', 'invoice', 'paid', 'balance', ...NAME], waCategory: 'UTILITY',
    copy: { subject: 'Balance {balance} on invoice {invoice}', text: 'Hi {name}, thank you — {paid} has been paid on invoice {invoice}. The balance due is {balance}. {hospital} {hospital_phone}', waParams: 'name,invoice,paid,balance' } },
  { id: 'invoice_cancelled', code: 'BIL-004', group: 'BIL', scope: 'hospital', audience: 'patient', label: 'Invoice cancelled',
    hint: 'An invoice is cancelled', channels: P, defaults: on('email', 'inapp'),
    tokens: ['name', 'invoice', 'amount', ...NAME], waCategory: 'UTILITY',
    copy: { subject: 'Invoice {invoice} cancelled', text: 'Hi {name}, invoice {invoice} for {amount} has been cancelled — you do not need to pay it. Questions? {hospital_phone}. {hospital}', waParams: 'name,invoice,amount' } },
  { id: 'invoice_overdue', code: 'BIL-005', group: 'BIL', scope: 'hospital', audience: 'patient', label: 'Payment overdue',
    hint: '1 and 7 days after the due date while a balance remains (10 am)', channels: P, defaults: on('sms', 'whatsapp', 'email'),
    tokens: ['name', 'invoice', 'balance', 'due_date', 'days', ...NAME], waCategory: 'UTILITY',
    copy: { subject: 'Reminder: {balance} due on invoice {invoice}', text: 'Hi {name}, {balance} on invoice {invoice} was due on {due_date} ({days} days ago). Please pay at the reception or call {hospital_phone}. {hospital}',
      waParams: 'name,balance,invoice,due_date' } },
  // ---------------------------------------------------------------- privacy
  { id: 'privacy_request_resolved', code: 'PRV-002', group: 'PRV', scope: 'hospital', audience: 'patient', label: 'Privacy request answered',
    hint: 'The owner closes a patient\'s privacy (DPDP) request', channels: P, defaults: on('email', 'inapp'),
    tokens: ['name', 'kind', 'status', 'resolution', 'hospital'], waCategory: 'UTILITY',
    copy: { subject: 'Your {kind} request: {status}', text: 'Hi {name}, your data {kind} request to {hospital} is {status}. {resolution}', waParams: 'name,kind,status' } },
  // ---------------------------------------------------------------- owner digest
  { id: 'owner_daily_digest', code: 'HSP-001', group: 'HSP', scope: 'hospital', audience: 'owner', label: 'Daily summary (to the owner)',
    hint: 'Every evening at 8:30 — the day in numbers', channels: OWNER, defaults: on('email', 'inapp'),
    tokens: ['name', 'date', 'appointments', 'completed', 'cancelled', 'no_show', 'new_patients', 'admissions', 'discharges', 'collected', 'outstanding', 'link', 'hospital'], waCategory: 'UTILITY',
    copy: { subject: '{hospital} today: {appointments} visits, {collected} collected',
      text: 'Good evening {name}, here is {hospital} on {date}:\n• Appointments: {appointments} ({completed} completed, {cancelled} cancelled, {no_show} no-show)\n• New patients: {new_patients}\n• Admissions: {admissions} · Discharges: {discharges}\n• Collected: {collected} · Outstanding: {outstanding}\nDashboard: {link}',
      waText: '📊 *{hospital} — {date}*\n\n🗓 Appointments: *{appointments}* ({completed} done, {cancelled} cancelled, {no_show} no-show)\n🧑 New patients: {new_patients}\n🛏 Admitted {admissions} · Discharged {discharges}\n💰 Collected *{collected}* · Due {outstanding}\n\n{link}',
      pushText: '{appointments} visits · {collected} collected · {outstanding} due', waParams: 'name,date,appointments,collected' } },
]

/** sent by the platform to a hospital's owner — wording edited only in the control panel */
export const PLATFORM_OWNER_EVENTS: CatalogEntry[] = [
  { id: 'signup_welcome', code: 'TEN-001', group: 'TEN', scope: 'platform_owner', audience: 'owner', label: 'Welcome (free trial sign-up)',
    hint: 'A hospital signs up for the free trial', channels: ['email'], defaults: on('email'), tokens: ['name', 'hospital', 'link', 'days', 'email'], waCategory: 'UTILITY',
    copy: { subject: 'Your free trial of {hospital} is ready', text: 'Namaste {name}, {hospital} is ready — free for {days} days. Create your owner account with this e-mail ({email}) here: {link} . After that, invite your team from Users & Roles. Reply to this e-mail if you need help.' } },
  { id: 'owner_invite', code: 'TEN-002', group: 'TEN', scope: 'platform_owner', audience: 'owner', label: 'Owner invitation',
    hint: 'The platform team creates a hospital and invites its owner', channels: ['email'], defaults: on('email'), tokens: ['email', 'link', 'platform', 'hospital'], waCategory: 'UTILITY',
    copy: { subject: 'Your {hospital} account is ready', text: 'Namaste! {hospital} is ready on {platform}. Create the owner account with this e-mail ({email}) here: {link}' } },
  { id: 'tenant_suspended', code: 'TEN-003', group: 'TEN', scope: 'platform_owner', audience: 'owner', label: 'Hospital suspended',
    hint: 'The platform team suspends the hospital', channels: OWNER, defaults: on('email', 'whatsapp', 'inapp'), tokens: ['name', 'hospital', 'platform', 'support'], waCategory: 'UTILITY',
    copy: { subject: '{hospital} has been suspended', text: 'Namaste {name}, {hospital} has been suspended on {platform}. Staff and patients cannot sign in until it is restored. Please contact {support}.' } },
  { id: 'tenant_reactivated', code: 'TEN-004', group: 'TEN', scope: 'platform_owner', audience: 'owner', label: 'Hospital restored',
    hint: 'A suspended hospital is active again', channels: OWNER, defaults: on('email', 'whatsapp', 'inapp'), tokens: ['name', 'hospital', 'platform', 'link'], waCategory: 'UTILITY',
    copy: { subject: '{hospital} is active again', text: 'Namaste {name}, {hospital} is active again on {platform}. Everyone can sign in as before: {link}' } },
  { id: 'domain_verified', code: 'TEN-005', group: 'TEN', scope: 'platform_owner', audience: 'owner', label: 'Custom domain connected',
    hint: 'A custom domain is verified and live', channels: OWNER, defaults: on('email', 'inapp'), tokens: ['name', 'hospital', 'domain'], waCategory: 'UTILITY',
    copy: { subject: '{domain} is live', text: 'Namaste {name}, {domain} now opens {hospital}. Share it with your patients: https://{domain}' } },
  { id: 'hospital_closing', code: 'TEN-006', group: 'TEN', scope: 'platform_owner', audience: 'owner', label: 'Hospital closing (offboarding)',
    hint: 'The hospital account is being closed (data export window)', channels: ['email', 'push'], defaults: on('email', 'push'), tokens: ['hospital', 'date'], waCategory: 'UTILITY',
    copy: { subject: '{hospital}: your account is closing on {date}', text: 'Your Hospital Comrade account for {hospital} is now read-only and will be deleted after {date}. Download your data before then: Settings → Data → Export all data.' } },
  { id: 'incident_notice', code: 'TEN-007', group: 'TEN', scope: 'platform_owner', audience: 'owner', label: 'Security notice', freeText: true,
    hint: 'The platform team informs owners about a security incident', channels: ['email', 'push'], defaults: on('email', 'push'), tokens: ['hospital'], waCategory: 'UTILITY',
    copy: { subject: '{hospital}: security notice from Hospital Comrade', text: '(the message written when the notice is sent)' } },
  { id: 'privacy_request', code: 'PRV-001', group: 'PRV', scope: 'platform_owner', audience: 'owner', label: 'New privacy request (to the owner)',
    hint: 'A patient asks for data correction or erasure (DPDP)', channels: ['email', 'push', 'inapp'], defaults: on('email', 'push', 'inapp'), tokens: ['name', 'kind', 'hospital'], waCategory: 'UTILITY',
    copy: { subject: '{hospital}: new privacy request ({kind})', text: 'A patient ({name}) asked for data {kind}. Please answer within 30 days: Privacy requests in the app.' } },
  { id: 'billing_reminder', code: 'SUB-001', group: 'SUB', scope: 'platform_owner', audience: 'owner', label: 'Trial / plan ending',
    hint: '30, 15, 7, 3 and 1 day before the trial or plan ends, and when the grace period starts', channels: OWNER, defaults: on('email', 'push', 'inapp'),
    tokens: ['name', 'hospital', 'plan', 'date', 'days', 'read_only', 'link', 'milestone'], waCategory: 'UTILITY' },
  { id: 'subscription_payment_success', code: 'SUB-002', group: 'SUB', scope: 'platform_owner', audience: 'owner', label: 'Subscription payment received',
    hint: 'A plan or wallet payment succeeds', channels: OWNER, defaults: on('email', 'inapp'), tokens: ['name', 'hospital', 'amount', 'what', 'invoice_no', 'until', 'link', 'platform'], waCategory: 'UTILITY',
    copy: { subject: 'Payment received — {amount}', text: 'Namaste {name}, we received {amount} for {what} ({hospital}). Invoice {invoice_no}. {until} Thank you for choosing {platform}. Invoices: {link}' } },
  { id: 'subscription_payment_failed', code: 'SUB-003', group: 'SUB', scope: 'platform_owner', audience: 'owner', label: 'Subscription payment failed',
    hint: 'A plan or wallet payment fails', channels: OWNER, defaults: on('email', 'whatsapp', 'inapp'), tokens: ['name', 'hospital', 'amount', 'what', 'link', 'platform'], waCategory: 'UTILITY',
    copy: { subject: 'Payment failed — {amount}', text: 'Namaste {name}, your payment of {amount} for {what} ({hospital}) did not go through. No money was taken, or it will be refunded by your bank. Try again: {link}' } },
  { id: 'plan_changed', code: 'SUB-004', group: 'SUB', scope: 'platform_owner', audience: 'owner', label: 'Plan changed',
    hint: 'The hospital moves to another plan', channels: OWNER, defaults: on('email', 'inapp'), tokens: ['name', 'hospital', 'plan', 'old_plan', 'link'], waCategory: 'UTILITY',
    copy: { subject: '{hospital} is now on the {plan} plan', text: 'Namaste {name}, {hospital} moved from the {old_plan} plan to the {plan} plan. See what is included: {link}' } },
  { id: 'trial_extended', code: 'SUB-005', group: 'SUB', scope: 'platform_owner', audience: 'owner', label: 'Trial extended',
    hint: 'The platform team extends the free trial', channels: OWNER, defaults: on('email', 'inapp'), tokens: ['name', 'hospital', 'date', 'platform'], waCategory: 'UTILITY',
    copy: { subject: 'Your free trial now runs until {date}', text: 'Good news {name} — the {platform} free trial for {hospital} has been extended until {date}.' } },
  { id: 'wallet_low_owner', code: 'SUB-006', group: 'SUB', scope: 'platform_owner', audience: 'owner', label: 'Message wallet low',
    hint: 'The messaging wallet drops below the low-balance line (at most once a week)', channels: OWNER, defaults: on('email', 'inapp'), tokens: ['name', 'hospital', 'balance', 'link'], waCategory: 'UTILITY',
    copy: { subject: 'Message wallet low: {balance} left', text: 'Namaste {name}, the {hospital} message wallet has {balance} left. Top up so SMS and WhatsApp keep going out: {link}' } },
  { id: 'plan_updated', code: 'SUB-008', group: 'SUB', scope: 'platform_owner', audience: 'owner', label: 'Plan updated',
    hint: 'The platform team changes the price, included messages or name of the hospital\'s plan', channels: OWNER, defaults: on('email', 'inapp'),
    tokens: ['name', 'hospital', 'plan', 'changes', 'link', 'platform'], waCategory: 'UTILITY',
    copy: { subject: 'An update to your {plan} plan', text: 'Namaste {name}, we have updated the {plan} plan that {hospital} is on. {changes} See your plan and invoices: {link}' } },
  { id: 'message_quota_warning', code: 'SUB-007', group: 'SUB', scope: 'platform_owner', audience: 'owner', label: 'Monthly message limit at 80%',
    hint: 'A channel has used 80% of this month\'s allowance (once a month)', channels: OWNER, defaults: on('email', 'inapp'), tokens: ['name', 'hospital', 'channel', 'used', 'limit', 'link'], waCategory: 'UTILITY',
    copy: { subject: '{channel}: {used} of {limit} messages used this month', text: 'Namaste {name}, {hospital} has sent {used} of its {limit} {channel} messages this month. After the limit they pause until next month. Need more? {link}' } },
]

/** alerts to the platform team (control panel → Alerts); subject/text may use {title}, {body}, {link}, {severity} */
const A = (id: string, code: string, label: string, hint: string): CatalogEntry => ({
  id, code, group: 'SYS', scope: 'platform', audience: 'team', label, hint, channels: ['email', 'whatsapp', 'push', 'inapp'], defaults: on('email', 'inapp'),
  tokens: ['title', 'body', 'link', 'severity'], waCategory: 'UTILITY', copy: { subject: '{title}', text: '{title}\n\n{body}' },
})
export const PLATFORM_ALERT_EVENTS: CatalogEntry[] = [
  A('signup_new', 'SYS-001', 'New sign-up', 'A hospital signs up for the free trial'),
  A('lead_new', 'SYS-002', 'New call-back request', 'A visitor asks for a call back on the platform website'),
  A('trial_ending', 'SYS-003', 'Trial ending soon', 'A hospital\'s trial ends within the warning days'),
  A('payment_paid', 'SYS-004', 'Payment received', 'A hospital pays for a plan or wallet top-up'),
  A('payment_failed', 'SYS-005', 'Payment failed', 'A hospital\'s payment fails'),
  A('wallet_low', 'SYS-006', 'Hospital wallet running low', 'A hospital\'s message wallet is low'),
  A('incident_new', 'SYS-007', 'Incident logged', 'A security incident is logged'),
  A('health_down', 'SYS-008', 'Service down', 'A health check fails (site, database, provider, server…)'),
  A('job_late', 'SYS-009', 'Scheduled job late or failing', 'pg_cron jobs stopped or failing'),
  A('delivery_spike', 'SYS-010', 'Message failures spiking', 'Many messages failing in the last hour'),
  A('threshold', 'SYS-011', 'Limit crossed', 'Queue, database, storage, SSL, server CPU / RAM / disk'),
  A('health_recovered', 'SYS-012', 'Service back to normal', 'A failing check passes again'),
  A('tenant_status', 'SYS-013', 'Hospital suspended / restored', 'A hospital\'s status changes to or from suspended'),
  A('domain_added', 'SYS-014', 'Custom domain added', 'A hospital connects a custom domain'),
  A('impersonation', 'SYS-015', 'Signed in as a user', 'A team member uses “Sign in as user” (security audit)'),
  A('platform_digest', 'SYS-016', 'Daily platform summary', 'Every morning at 8:30 — sign-ups, revenue, messages, health'),
]
