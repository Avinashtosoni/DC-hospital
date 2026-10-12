// WhatsApp booking chatbot — a small, dependency-free state machine.
// Used by the `whatsapp-bot` Edge Function (Deno), by the in-app simulator (Settings → Notifications) and by tests.
// All I/O goes through `BotDeps`, so the same conversation logic runs against Supabase or the local demo data.
//
// Menu:  1 Book an appointment · 2 My appointments (cancel) · 3 Timings & address · 4 Talk to reception
// Anytime: "menu" / "hi" restarts, "hindi" / "english" switches language.

export type BotLang = 'en' | 'hi'
export interface BotDoctor { id: string; name: string; specialization: string; department?: string | null; fee: number }
export interface BotSlot { date: string; time: string }
export interface BotAppt { id: string; ref: string; date: string; time: string; doctor: string; status: string }
export interface BotBooked { ref: string; date: string; time: string; doctor: string; total: number; mrn?: string | null }
export interface BotDeps {
  hospital: { name: string; phone: string; address: string; hours?: string; site?: string }
  doctors(): Promise<BotDoctor[]>
  freeSlots(doctorId: string): Promise<BotSlot[]>
  patient(): Promise<{ full_name: string } | null>
  book(input: { doctorId: string; date: string; time: string; name: string; reason: string | null }): Promise<BotBooked>
  upcoming(): Promise<BotAppt[]>
  cancel(apptId: string): Promise<void>
}
type Step = 'menu' | 'dept' | 'doctor' | 'slot' | 'name' | 'reason' | 'confirm' | 'appts' | 'cancel'
export interface BotState {
  step: Step; lang: BotLang; at?: number
  depts?: string[]; dept?: string
  docs?: { id: string; name: string; fee: number }[]; doctor?: { id: string; name: string; fee: number }
  slots?: BotSlot[]; slot?: BotSlot
  name?: string; reason?: string | null
  appts?: BotAppt[]; appt?: BotAppt
}
export const newBotState = (lang: BotLang = 'en'): BotState => ({ step: 'menu', lang })
const SESSION_MS = 30 * 60_000

// ------------------------------------------------------------------ texts
const T = {
  en: {
    hello: (h: string, n?: string) => `🙏 Namaste${n ? ` ${n}` : ''}! Welcome to *${h}*.\nReply with a number:`,
    menu: '1️⃣ Book an appointment\n2️⃣ My appointments\n3️⃣ Timings & address\n4️⃣ Talk to reception\n\n_Type *hindi* for हिन्दी · *menu* anytime to start over_',
    pickDept: 'Which speciality do you need? Reply with a number:',
    pickDoc: (d: string) => `Doctors in *${d}* — reply with a number:`,
    noDocs: 'Sorry, no doctors are taking online bookings right now.',
    pickSlot: (d: string) => `Next free slots with *${d}* — reply with a number:`,
    noSlots: (d: string, p: string) => `Sorry, ${d} has no free slots in the booking window. Reply *menu* to pick another doctor or call ${p}.`,
    askName: 'Please type the *patient’s full name*.',
    knownName: (n: string) => `Is this appointment for *${n}*?\n1️⃣ Yes\nOr type another patient’s full name.`,
    askReason: 'Briefly, what is the reason for the visit? (or reply *0* to skip)',
    confirm: (s: BotState, fee: string) => `Please confirm:\n👤 ${s.name}\n🩺 ${s.doctor!.name}\n🗓 ${fmtWhen(s.slot!, 'en')}\n💰 Consultation ${fee} — pay at the hospital\n\n1️⃣ Confirm booking\n2️⃣ Choose another time`,
    booked: (b: BotBooked, total: string) => `✅ *Appointment confirmed*\nRef: *${b.ref}*\n🩺 ${b.doctor}\n🗓 ${fmtWhen({ date: b.date, time: b.time }, 'en')}\n💰 ${total} payable at reception${b.mrn ? `\nMRN: ${b.mrn}` : ''}\n\nPlease arrive 15 minutes early with a photo ID. Reply *2* anytime to see or cancel your appointments.`,
    bookFail: (e: string) => `⚠️ ${e}\nReply with another slot number, or *menu* to start over.`,
    noAppts: 'You have no upcoming appointments. Reply *1* to book one.',
    appts: 'Your upcoming appointments — reply with a number to cancel it, or *menu* to go back:',
    confirmCancel: (a: BotAppt) => `Cancel your appointment with ${a.doctor} on ${fmtWhen(a, 'en')} (ref ${a.ref})?\n1️⃣ Yes, cancel\n2️⃣ No, keep it`,
    cancelled: (a: BotAppt) => `❌ Cancelled: ${a.doctor}, ${fmtWhen(a, 'en')}. Reply *1* to book a new time.`,
    kept: 'Okay, your appointment is unchanged.',
    info: (h: BotDeps['hospital']) => `🏥 *${h.name}*\n📍 ${h.address}\n🕘 ${h.hours || 'OPD Mon–Sat, 9 AM – 6 PM · Emergency 24×7'}\n📞 ${h.phone}${h.site ? `\n🌐 ${h.site}` : ''}`,
    human: (p: string) => `Our reception team will help you. Please call 📞 ${p} (9 AM – 8 PM), or reply here and we’ll get back to you.`,
    invalid: 'Sorry, I didn’t get that. Please reply with one of the numbers above.',
    error: (p: string) => `Sorry, something went wrong on our side. Please try again, or call ${p}.`,
    more: (n: number) => `…and ${n} more. Type a name to search.`,
  },
  hi: {
    hello: (h: string, n?: string) => `🙏 नमस्ते${n ? ` ${n}` : ''}! *${h}* में आपका स्वागत है।\nनंबर लिखकर जवाब दें:`,
    menu: '1️⃣ अपॉइंटमेंट बुक करें\n2️⃣ मेरे अपॉइंटमेंट\n3️⃣ समय और पता\n4️⃣ रिसेप्शन से बात करें\n\n_English के लिए *english* लिखें · शुरू से करने के लिए *menu*_',
    pickDept: 'किस विभाग के डॉक्टर चाहिए? नंबर लिखें:',
    pickDoc: (d: string) => `*${d}* के डॉक्टर — नंबर लिखें:`,
    noDocs: 'माफ़ कीजिए, अभी कोई डॉक्टर ऑनलाइन बुकिंग नहीं ले रहे हैं।',
    pickSlot: (d: string) => `*${d}* के अगले ख़ाली समय — नंबर लिखें:`,
    noSlots: (d: string, p: string) => `माफ़ कीजिए, ${d} के पास अभी कोई ख़ाली समय नहीं है। दूसरा डॉक्टर चुनने के लिए *menu* लिखें या ${p} पर कॉल करें।`,
    askName: 'कृपया *मरीज़ का पूरा नाम* लिखें।',
    knownName: (n: string) => `क्या यह अपॉइंटमेंट *${n}* के लिए है?\n1️⃣ हाँ\nया किसी और मरीज़ का पूरा नाम लिखें।`,
    askReason: 'आने का कारण संक्षेप में लिखें (या छोड़ने के लिए *0* लिखें)',
    confirm: (s: BotState, fee: string) => `कृपया पुष्टि करें:\n👤 ${s.name}\n🩺 ${s.doctor!.name}\n🗓 ${fmtWhen(s.slot!, 'hi')}\n💰 परामर्श शुल्क ${fee} — भुगतान अस्पताल में\n\n1️⃣ बुकिंग पक्की करें\n2️⃣ दूसरा समय चुनें`,
    booked: (b: BotBooked, total: string) => `✅ *अपॉइंटमेंट पक्का हो गया*\nनंबर: *${b.ref}*\n🩺 ${b.doctor}\n🗓 ${fmtWhen({ date: b.date, time: b.time }, 'hi')}\n💰 ${total} रिसेप्शन पर देय${b.mrn ? `\nMRN: ${b.mrn}` : ''}\n\nकृपया फ़ोटो ID के साथ 15 मिनट पहले पहुँचें। अपॉइंटमेंट देखने या रद्द करने के लिए कभी भी *2* लिखें।`,
    bookFail: (e: string) => `⚠️ ${e}\nकोई दूसरा समय नंबर लिखें, या शुरू से करने के लिए *menu*।`,
    noAppts: 'आपका कोई आने वाला अपॉइंटमेंट नहीं है। बुक करने के लिए *1* लिखें।',
    appts: 'आपके आने वाले अपॉइंटमेंट — रद्द करने के लिए नंबर लिखें, या वापस जाने के लिए *menu*:',
    confirmCancel: (a: BotAppt) => `${fmtWhen(a, 'hi')} को ${a.doctor} के साथ अपॉइंटमेंट (नंबर ${a.ref}) रद्द करें?\n1️⃣ हाँ, रद्द करें\n2️⃣ नहीं, रहने दें`,
    cancelled: (a: BotAppt) => `❌ रद्द किया गया: ${a.doctor}, ${fmtWhen(a, 'hi')}। नया समय बुक करने के लिए *1* लिखें।`,
    kept: 'ठीक है, आपका अपॉइंटमेंट पहले जैसा है।',
    info: (h: BotDeps['hospital']) => `🏥 *${h.name}*\n📍 ${h.address}\n🕘 ${h.hours || 'OPD सोम–शनि, सुबह 9 – शाम 6 · इमरजेंसी 24×7'}\n📞 ${h.phone}${h.site ? `\n🌐 ${h.site}` : ''}`,
    human: (p: string) => `हमारी रिसेप्शन टीम आपकी मदद करेगी। कृपया 📞 ${p} पर कॉल करें (सुबह 9 – रात 8), या यहीं लिखें, हम जवाब देंगे।`,
    invalid: 'माफ़ कीजिए, समझ नहीं आया। कृपया ऊपर दिए गए नंबरों में से एक लिखें।',
    error: (p: string) => `माफ़ कीजिए, हमारी तरफ़ से कुछ गड़बड़ हुई। फिर से कोशिश करें, या ${p} पर कॉल करें।`,
    more: (n: number) => `…और ${n}। खोजने के लिए नाम लिखें।`,
  },
}

const DAYS = { en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], hi: ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि'] }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function fmtWhen(s: { date: string; time: string }, lang: BotLang) {
  const [y, m, d] = s.date.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const [h, min] = s.time.slice(0, 5).split(':').map(Number)
  return `${DAYS[lang][dow]}, ${d} ${MONTHS[m - 1]} · ${((h + 11) % 12) + 1}:${String(min).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}
const rs = (n: number) => `₹${new Intl.NumberFormat('en-IN').format(Math.round(n))}`
const numbered = (items: string[]) => items.map((x, i) => `*${i + 1}.* ${x}`).join('\n')
const pick = <T,>(list: T[] | undefined, text: string): T | undefined => {
  const n = Number(text.replace(/[^\d]/g, ''))
  return list && /^\s*\d+\s*\.?\s*$/.test(text) && n >= 1 && n <= list.length ? list[n - 1] : undefined
}
const norm = (s: string) => s.trim().toLowerCase()
const MAX_LIST = 9

/** Handle one incoming message; returns the new state and the reply messages to send. */
export async function botReply(prev: BotState | null | undefined, rawText: string, deps: BotDeps, now = Date.now()): Promise<{ state: BotState; replies: string[] }> {
  let s: BotState = prev && prev.at && now - prev.at < SESSION_MS ? { ...prev } : newBotState(prev?.lang)
  const text = (rawText ?? '').trim()
  const cmd = norm(text)
  const out: string[] = []
  const L = () => T[s.lang]
  const done = (st: BotState) => ({ state: { ...st, at: now }, replies: out })

  const showMenu = async (greet = true) => {
    let name: string | undefined
    if (greet) { try { name = (await deps.patient())?.full_name?.split(' ')[0] } catch { /* ignore */ } }
    out.push(`${greet ? L().hello(deps.hospital.name, name) + '\n\n' : ''}${L().menu}`)
    s = { step: 'menu', lang: s.lang }
  }
  const showDepts = async () => {
    const docs = await deps.doctors()
    const depts = [...new Set(docs.map((d) => d.department || d.specialization))].sort()
    if (!depts.length) { out.push(L().noDocs); await showMenu(false); return }
    s = { ...s, step: 'dept', depts }
    out.push(`${L().pickDept}\n${numbered(depts)}`)
  }
  const showDocs = async (dept: string, filter = '') => {
    const all = (await deps.doctors()).filter((d) => (d.department || d.specialization) === dept)
    const docs = (filter ? all.filter((d) => d.name.toLowerCase().includes(filter)) : all).slice(0, MAX_LIST)
    s = { ...s, step: 'doctor', dept, docs: docs.map((d) => ({ id: d.id, name: d.name, fee: d.fee })) }
    out.push(`${L().pickDoc(dept)}\n${numbered(docs.map((d) => `${d.name} — ${d.specialization} · ${rs(d.fee)}`))}${all.length > docs.length && !filter ? `\n${L().more(all.length - docs.length)}` : ''}`)
  }
  const showSlots = async () => {
    const slots = (await deps.freeSlots(s.doctor!.id)).slice(0, 8)
    if (!slots.length) { out.push(L().noSlots(s.doctor!.name, deps.hospital.phone)); s = { ...s, step: 'doctor' }; return }
    s = { ...s, step: 'slot', slots }
    out.push(`${L().pickSlot(s.doctor!.name)}\n${numbered(slots.map((x) => fmtWhen(x, s.lang)))}`)
  }
  const askName = async () => {
    let known: string | undefined
    try { known = (await deps.patient())?.full_name } catch { /* ignore */ }
    s = { ...s, step: 'name', name: known }
    out.push(known ? L().knownName(known) : L().askName)
  }

  try {
    // global commands
    if (['hindi', 'हिन्दी', 'हिंदी', 'hi-in'].includes(cmd)) { s.lang = 'hi'; await showMenu(); return done(s) }
    if (['english', 'eng', 'अंग्रेज़ी'].includes(cmd)) { s.lang = 'en'; await showMenu(); return done(s) }
    const greeting = ['menu', 'hi', 'hello', 'hey', 'namaste', 'नमस्ते', 'start', 'मेनू', '#'].includes(cmd)
    const fresh = !prev || !prev.at || now - prev.at >= SESSION_MS
    // a menu number on a fresh chat is answered directly; anything else starts with the greeting
    if (greeting || (fresh && !/^[1-4]$/.test(cmd))) { await showMenu(); return done(s) }

    switch (s.step) {
      case 'menu': {
        if (cmd === '1' || /book|बुक/.test(cmd)) await showDepts()
        else if (cmd === '2' || /my|appoint|मेरे/.test(cmd)) {
          const appts = await deps.upcoming()
          if (!appts.length) out.push(L().noAppts)
          else { s = { ...s, step: 'appts', appts }; out.push(`${L().appts}\n${numbered(appts.map((a) => `${fmtWhen(a, s.lang)} — ${a.doctor} (${a.ref})`))}`) }
        } else if (cmd === '3' || /time|address|timing|पता|समय/.test(cmd)) out.push(L().info(deps.hospital))
        else if (cmd === '4' || /help|call|reception|human|रिसेप्शन/.test(cmd)) out.push(L().human(deps.hospital.phone))
        else out.push(`${L().invalid}\n\n${L().menu}`)
        break
      }
      case 'dept': {
        const d = pick(s.depts, text) ?? s.depts?.find((x) => x.toLowerCase().includes(cmd) && cmd.length >= 3)
        if (d) await showDocs(d)
        else out.push(`${L().invalid}\n${numbered(s.depts ?? [])}`)
        break
      }
      case 'doctor': {
        const d = pick(s.docs, text)
        if (d) { s = { ...s, doctor: d }; await showSlots() }
        else if (cmd.length >= 3 && s.dept) await showDocs(s.dept, cmd)
        else out.push(`${L().invalid}\n${numbered((s.docs ?? []).map((x) => x.name))}`)
        break
      }
      case 'slot': {
        const sl = pick(s.slots, text)
        if (sl) { s = { ...s, slot: sl }; await askName() }
        else out.push(`${L().invalid}\n${numbered((s.slots ?? []).map((x) => fmtWhen(x, s.lang)))}`)
        break
      }
      case 'name': {
        if (s.name && (cmd === '1' || /^(yes|haan|han|ha|हाँ|हां)$/.test(cmd))) { /* keep known name */ }
        else if (text.replace(/[^\p{L} .']/gu, '').trim().length >= 2 && !/^\d+$/.test(cmd)) s = { ...s, name: text.replace(/\s+/g, ' ').slice(0, 80) }
        else { out.push(L().askName); break }
        s = { ...s, step: 'reason' }
        out.push(L().askReason)
        break
      }
      case 'reason': {
        s = { ...s, step: 'confirm', reason: cmd === '0' || cmd === 'skip' ? null : text.slice(0, 300) }
        out.push(L().confirm(s, rs(s.doctor!.fee)))
        break
      }
      case 'confirm': {
        if (cmd === '2') { await showSlots(); break }
        if (cmd !== '1' && !/^(yes|confirm|haan|हाँ|हां)$/.test(cmd)) { out.push(L().confirm(s, rs(s.doctor!.fee))); break }
        try {
          const b = await deps.book({ doctorId: s.doctor!.id, date: s.slot!.date, time: s.slot!.time, name: s.name!, reason: s.reason ?? null })
          out.push(L().booked(b, rs(b.total)))
          s = { step: 'menu', lang: s.lang }
        } catch (e) {
          out.push(L().bookFail(String((e as Error).message ?? e).replace(/^[A-Z_]+:\s*/, '')))
          const slots = (await deps.freeSlots(s.doctor!.id)).slice(0, 8)
          s = { ...s, step: 'slot', slots }
          if (slots.length) out.push(numbered(slots.map((x) => fmtWhen(x, s.lang))))
        }
        break
      }
      case 'appts': {
        const a = pick(s.appts, text)
        if (a) { s = { ...s, step: 'cancel', appt: a }; out.push(L().confirmCancel(a)) }
        else out.push(`${L().invalid}\n${numbered((s.appts ?? []).map((x) => `${fmtWhen(x, s.lang)} — ${x.doctor}`))}`)
        break
      }
      case 'cancel': {
        if (cmd === '1' || /^(yes|haan|हाँ|हां)$/.test(cmd)) { await deps.cancel(s.appt!.id); out.push(L().cancelled(s.appt!)) }
        else out.push(L().kept)
        s = { step: 'menu', lang: s.lang }
        break
      }
    }
  } catch (e) {
    console.error('bot error', e)
    out.push(L().error(deps.hospital.phone))
    s = { step: 'menu', lang: s.lang }
  }
  return done(s)
}
