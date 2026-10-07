# Step-by-step setup guide: Supabase → Coolify → staging test → go live

Yeh guide demo deployment ko **asli database wali app** mein badalne ke liye hai. Har step ke baad ek **✅ Check**
diya hai. Check pass na ho to aage mat badhiye. Kisi step par atak jaayein to us step ka number aur screen par aaya error
batayein.

Is guide ka kaam order batana hai. Har step ki poori details [GO_LIVE.md](GO_LIVE.md) mein hain, aur hospital/messaging
ki details [MULTI_TENANCY.md](MULTI_TENANCY.md) mein.

> **🔐 Secrets ka niyam:** `service_role` key, database password, Razorpay secret, API tokens — yeh **kabhi** chat,
> GitHub, WhatsApp ya screenshot mein mat daaliye. Inhe sirf Supabase / Coolify ke secret fields mein seedha paste
> kariye aur ek password manager mein rakhiye. Help ke liye sirf **Project URL / project ref** (yeh public hain) aur
> error message share kariye.

---

## Step 0 — Pehle tay kar lijiye

| Sawaal | Sujhaav |
|---|---|
| Kitne Supabase projects? | **Option A (behtar):** 2 projects. `hc-staging` testing ke liye Free plan par, aur `hc-production` asli hospitals ke liye Pro plan ($25/month) par. **Option B (sasta):** 1 Pro project. Usi par test kariye. Test hospital ko baad mein control panel se *Close* kariye, phir notice period (kam se kam 7 din) ke baad *Purge*. |
| Region | **South Asia (Mumbai) `ap-south-1`**, kyunki patients India mein hain aur data bhi wahin rahega |
| Domain | Production: `<your-domain>` (jaise `hospital.digitalcomrade.in`). Staging: `staging.<your-domain>` |
| Supabase CLI | Laptop par Node 20+ hona chahiye. CLI `npx supabase …` se bina install kiye chal jaata hai |

Option A mein yeh poori guide pehle **staging** project par chalaiye, phir production par dobara (Step 1–6, 8–9).
Dusri baar 1–2 ghante lagenge.

---

## Credentials sheet — inhe ek password manager mein bharte jaiye

| # | Cheez | Kahan milegi | Kahan daalni hai | Secret? |
|---|---|---|---|---|
| C1 | Project URL `https://<ref>.supabase.co` | Supabase → Project Settings → **API** (Data API) | Coolify `VITE_SUPABASE_URL` | Nahi |
| C2 | Project ref (URL ka `<ref>` hissa) | Wahi | `supabase link` | Nahi |
| C3 | **anon** key (lambi `eyJ…` wali) | Project Settings → **API Keys** → *Legacy API keys* tab → `anon` `public` | Coolify `VITE_SUPABASE_ANON_KEY` | Nahi (browser mein jaati hai; RLS data ki raksha karta hai) |
| C4 | `service_role` key | Wahi tab | **Kahin nahi.** Edge Functions ko yeh apne aap mil jaati hai | **HAAN, sabse zaroori** |
| C5 | Database password | Project banate waqt | Backup connection string | **HAAN** |
| C6 | Session pooler connection string | Project → **Connect** → *Session pooler* | GitHub secret `SUPABASE_DB_URL` (backup) | **HAAN** (password hota hai) |
| C7 | SMTP (Resend / Zoho / SES): host, port, user, password, from-address | Email provider ka dashboard | Supabase → Auth → SMTP | **HAAN** |
| C8 | Razorpay Key ID + Key Secret (staging mein **Test mode**) | Razorpay → Account & Settings → API Keys | Edge Function secrets (`billing`) | Secret: haan |
| C9 | Razorpay webhook secret (aap khud banayein, lambi random string) | Razorpay → Webhooks | Edge Function secret `RAZORPAY_WEBHOOK_SECRET` | **HAAN** |
| C10 | Email sending key (Resend / SendGrid) | Provider dashboard | Edge Function secrets (`notify`) | **HAAN** |
| C11 | SMS: MSG91 / Fast2SMS key, DLT sender ID, DLT entity ID | Provider + DLT portal | Edge Function secrets (`notify`) | Key: haan |
| C12 | WhatsApp: AiSensy / Meta / MSG91 / OpenWA keys | Provider dashboard | Edge Function secrets (`notify`) | **HAAN** |
| C13 | Cloudflare API token + Zone ID (hospitals ke apne domain ke liye) | Cloudflare → My Profile → API Tokens | Edge Function secrets (`domains`) | **HAAN** |
| C14 | `BACKUP_PASSPHRASE` (lambi random string, **offline copy bhi rakhiye**) | Khud banayein | GitHub Actions secret | **HAAN** |

C10–C13 pehle din zaroori nahi hain. Inke bina bhi app chalegi, bas us channel ke messages "not available" dikhayenge.
Staging test ke liye kam se kam **C1–C9 aur C10 (email)** chahiye.

---

## Step 1 — Supabase project banaiye

1. supabase.com → **New project** → naam (`hc-staging` / `hc-production`), region **Mumbai**, ek strong database
   password (**C5**, password manager mein save kariye).
2. Project ready hone ke baad (2–3 minute): **Database → Extensions** → `pg_cron` aur `pg_net` dhoondh kar **Enable**
   kariye.
3. **SQL Editor → New query**:
   - Repo se `supabase/production.sql` kholiye (GitHub par: *Raw* → saara copy).
   - `✏️` wali line dhoondhiye (`owner_email', 'owner@your-hospital.in'`). Wahan us vyakti ka **asli email** likhiye jo
     platform ke apne (main) hospital ka Owner banega.
   - Poori file paste karke **Run** dabaiye. Isme 30–60 second lag sakte hain.
   - ⚠️ `master.sql` **mat** chalaiye. Woh demo data aur demo logins wali file hai.
4. ✅ **Check:** nayi query mein `select public.platform_signup_info();` chalaiye. Result mein `"enabled": true` aana
   chahiye.

## Step 2 — Auth settings (yeh step bahut zaroori hai)

1. **Authentication → Sign In / Providers → Email**: **Confirm email = ON** hona chahiye. ⚠️ Ise kabhi off mat
   kariye: owner, doctor aur staff apne hospital se email ke zariye jude hote hain.
2. **Authentication → URL Configuration**:
   - Site URL: `https://<your-domain>` (staging par `https://staging.<your-domain>`)
   - Redirect URLs: `https://<your-domain>/**` (har hospital ka apna domain jab judega, uska bhi `/**` yahan add kariye)
3. **Authentication → Emails → SMTP Settings**: **C7** bhariye. Supabase ka built-in mailer ghante mein sirf kuch hi
   email bhejta hai, isliye launch ke din sign-ups fail ho jaate.
4. ✅ **Check:** Auth → Emails → *Confirm signup* template mein `{{ .ConfirmationURL }}` maujood ho. Step 9 ka
   preflight bhi confirm-email ki setting check karega.

## Step 3 — Edge Functions deploy kariye

Laptop par, repo folder ke andar:

```bash
npx supabase login                                   # browser khulega, Supabase account se login kariye
npx supabase link --project-ref <C2>                 # database password (C5) maangega
npx supabase functions deploy notify
npx supabase functions deploy whatsapp-bot --no-verify-jwt
npx supabase functions deploy domains
npx supabase functions deploy billing --no-verify-jwt
npx supabase functions deploy impersonate
npx supabase functions deploy ops                    # control panel: team alerts, broadcasts, health checks, test sends
```

> Docker install nahi hai aur deploy fail ho raha hai, to har command ke aakhir mein `--use-api` jod kar dobara chalaiye.

**Secrets** (Supabase → Edge Functions → **Secrets** → Add). Staging ke liye sabse pehle yeh daaliye:

| Secret | Value |
|---|---|
| `PLATFORM_NAME` | `Hospital Comrade` (ya aapka brand) |
| `PLATFORM_DOMAIN` | `<your-domain>` (bina `https://` ke) |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | **C8** (staging = `rzp_test_…`). Ya control panel → Platform settings → Integrations → Razorpay mein daalein (Vault, panel wali keys pehle use hoti hain) |
| `RAZORPAY_WEBHOOK_SECRET` | **C9** (ya wahi Integrations card) |
| `PLATFORM_EMAIL_PROVIDER` | `resend` ya `sendgrid` |
| `PLATFORM_EMAIL_FROM` | jaise `notifications@<your-domain>` (yeh domain provider par verified hona chahiye) |
| `PLATFORM_RESEND_API_KEY` *ya* `PLATFORM_SENDGRID_API_KEY` | **C10** |

SMS, WhatsApp aur Cloudflare ke secret names [MULTI_TENANCY.md → Hospital Comrade messaging](MULTI_TENANCY.md#hospital-comrade-messaging-shared-accounts)
aur [GO_LIVE.md step 2](GO_LIVE.md#2-edge-functions) mein hain. Woh baad mein bhi daal sakte hain.

✅ **Check:** Edge Functions list mein chaaron functions *Active* dikhein.

## Step 4 — Coolify par app (staging)

1. Coolify → **New Resource → Application** → yeh GitHub repo → **Dockerfile** build → port **80**.
   - Staging ke liye branch: `arena/01a0e0e7-dc-hospital`. PR #1 merge hone ke baad production ke liye `main`.
   - Purani demo app ko mat chhediye. Woh demo ke roop mein chalti rahegi (GO_LIVE.md → *Moving from the demo deployment*).
2. **Environment Variables:**

| Variable | Staging | Production |
|---|---|---|
| `VITE_SUPABASE_URL` | C1 | C1 (production project) |
| `VITE_SUPABASE_ANON_KEY` | C3 | C3 (production project) |
| `REQUIRE_BACKEND` | (optional — ab zaroori nahi, demo mode hata diya gaya hai) | (optional) |
| `TENANCY` | `multi` | `multi` |
| `APP_ENV` | `staging` (Google index nahi karega, "Staging" badge dikhega) | `production` |
| `PLATFORM_NAME` / `PLATFORM_DOMAIN` | brand / `staging.<your-domain>` | brand / `<your-domain>` |
| `PLATFORM_LEGAL_NAME`, `PLATFORM_ADDRESS`, `PLATFORM_EMAIL`, `PLATFORM_PHONE`, `PLATFORM_GRIEVANCE_OFFICER`, `PLATFORM_JURISDICTION` | company details | company details |
| `CSP_MODE` / `HSTS` | `enforce` / `on` | `enforce` / `on` |

   Yeh values container start hote waqt padhi jaati hain. Inhe badalne ke baad sirf **Restart** chahiye, rebuild nahi.
3. **Domain:** Coolify app → Domains → `https://staging.<your-domain>`. DNS mein ek A record banaiye jo Coolify server
   (`157.173.109.129`) par point kare. Cloudflare use karte hain to SSL mode **Full (strict)** rakhiye.
4. ✅ **Check:**
   - `https://staging.<your-domain>/healthz` par `ok` dikhe.
   - `https://staging.<your-domain>/env.js` mein aapka Supabase URL aur `"TENANCY": "multi"` dikhe.
   - Login page par **demo accounts nahi** dikhne chahiye.

## Step 5 — Pehla admin aur main hospital ka owner

1. **Platform admin:** `https://staging.<your-domain>/?hospital=main` → *Create account* (apna kaam ka email) →
   inbox mein aaye link se email confirm kariye.
2. Supabase SQL Editor mein `supabase/snippets/add-provider.sql` paste kariye. `v_email` mein woh email aur
   `v_role := 'admin'` likh kar **Run** kariye.
3. `https://staging.<your-domain>/control-panel/` → login. Phir:
   - **Team** → ek **doosra admin** jodiye, taaki ek account lock hone par bhi platform tak pahunch bani rahe.
   - **Platform settings → Seller**: legal name, **GSTIN**, address, email. Yeh har invoice par chhapta hai.
   - Prices, GST %, trial aur grace days, aur **Sign-ups** ki settings check kariye.
4. **Main hospital ka owner:** Step 1.3 wale email se `?hospital=main` par sign up kariye → email confirm → login.
   Owner dashboard khulna chahiye.
5. Owner → **Settings → Notifications** → automatic delivery **ON**. Isse reminders, message delivery aur nightly
   clean-up ki scheduling shuru hoti hai.
6. ✅ **Check:** Control panel → **System health → Launch checklist**. Database wale checks hare (green) hone chahiye.
   Seller/GSTIN jaise bache hue kaam wahan dikh jayenge.

## Step 6 — Razorpay (staging mein Test mode)

1. Razorpay dashboard **Test mode** mein → Webhooks → *Add*:
   - URL: `https://<C2>.supabase.co/functions/v1/billing?webhook=razorpay`
   - Events: `payment.captured`, `payment.failed`, `order.paid`
   - Secret: **C9** (wahi jo Edge Function secret mein daala tha)
2. ✅ **Check:** Step 8 ka test **B4** pass ho.

---

## Step 7 — Preflight (laptop se)

```bash
npm ci
npm run preflight -- https://staging.<your-domain> --hospital=main
```

Har **✗** theek kariye aur har **!** padhiye. Isme yeh checks hote hain: headers, CSP, `env.js`, functions, auth
(confirm email ON, sign-up khula), service worker.

✅ **Check:** koi ✗ nahi bachna chahiye.

---

## Step 8 — Staging test checklist (asli flow, haath se)

Do browser rakhiye: ek normal window aur ek **Incognito**, taaki do alag log ek saath login ho sakein. Saath mein ek
asli phone bhi chahiye jis par OTP/WhatsApp aaye. Har test ke saath ✔ lagaiye, aur jo fail ho uska screenshot aur
browser console ka error note kariye.

### A. Hospital aur log
- [ ] **A1** Platform site → **Start free trial** → naya test hospital (`test-clinic`), apne doosre email se. Agar *Review first* on hai to control panel → **Sign-ups** → approve.
- [ ] **A2** Naye owner ko confirm email aaye → login → dashboard par **setup checklist** dikhe.
- [ ] **A3** Owner → sidebar → **Users & Roles** → **Doctor** ko invite kariye (teesra email) → invite link se signup → doctor ka dashboard khule.
- [ ] **A4** Isi tarah **Receptionist, Accountant, Staff** — har role ko sirf apne pages dikhein.
- [ ] **A5** **Hospitals ka alag-alag data:** `test-clinic` ka owner `main` hospital ka koi data na dekh paaye (URL mein `?hospital=main` daal kar bhi koshish kariye).

### B. Roz ka kaam
- [ ] **B1** Reception: naya patient → appointment → check-in.
- [ ] **B2** Doctor: appointment complete → prescription (dawaiyan) → lab test order → PDF/print.
- [ ] **B3** Accountant: invoice → payment record → invoice PDF par hospital ka naam aur logo ho.
- [ ] **B4** Owner → **Billing & plan** → wallet top-up ya plan payment, Razorpay **test card/UPI** se → payment success, platform invoice bane, control panel → **Payments** mein dikhe.
- [ ] **B5** Owner dashboard aur **Reports** mein aaj ki kamai sahi dikhe (B3 wali payment).

### C. Website, booking aur messages
- [ ] **C1** Owner → **Website CMS** → naam, phone, ek photo/logo upload → public website par dikhe (upload Supabase Storage mein jaata hai).
- [ ] **C2** Public site → **Book** → apna asli phone number → **OTP aaye** (SMS/WhatsApp, jo channel set kiya hai) → booking ho → reception ki list mein dikhe.
- [ ] **C3** **Forgot password** → email link aaye → naya password chale.
- [ ] **C4** Settings → Notifications → **Delivery log** mein messages *sent/delivered* hon, *failed* nahi.
- [ ] **C5** Patient signup (`patient` role) → patient portal → apni appointment dikhe → **Privacy** card → **Download** se apna data mile.

### D. Security aur browser
- [ ] **D1** Har badi screen par browser **DevTools → Console** kholiye. Laal rang wala `Content Security Policy` error **nahi** hona chahiye. Ho to uska text note kariye: woh live CSP ka issue hai.
- [ ] **D2** Mobile par site kholiye → "Add to Home screen" chale, page side mein scroll na ho.
- [ ] **D3** Owner → Settings → **Security** → idle sign-out **15 min** set kariye (default *Never* hai) → 15 minute kuch na karein → apne aap sign-out ho.

### E. Control panel
- [ ] **E1** Admin → Hospitals → `test-clinic` → **Extend trial** → → owner ko nayi date dikhe.
- [ ] **E2** Support role (Team se banaiye) → sirf assigned hospital dikhe.
- [ ] **E3** System health → failed messages / scheduled jobs → sab theek ho.

### F. Backup aur restore (sirf ek baar, launch se pehle)
- [ ] **F1** GitHub billing theek hone ke baad: repo → Settings → Secrets → Actions → `SUPABASE_DB_URL` (**C6**) aur `BACKUP_PASSPHRASE` (**C14**).
- [ ] **F2** Actions → **Database backup** → *Run workflow* → artifact download kariye.
- [ ] **F3** Ek **scratch** Supabase project par restore kariye (command [GO_LIVE.md step 8](GO_LIVE.md#8-backups) mein hai) → wahan tables aur data dikhe → scratch project delete kar dijiye.

> GitHub billing theek hone tak: Supabase Pro ka daily backup chalta rahega. Ek manual dump bhi le sakte hain:
> `pg_dump "<C6>" -Fc -f backup.dump`.

---

## Step 9 — Production par go-live

Staging ki checklist A–F pass hone ke baad hi:

1. **Production project:** Step 1–5 dobara chalaiye. Option B wale (ek hi project) test hospital ko control panel →
   Hospitals → test hospital → **Close** kariye (read-only ho jaata hai). Notice period ke baad wahin se **Purge**.
2. Razorpay: KYC → **Live mode** → live keys aur live webhook (Step 6, live secrets ke saath).
3. Coolify production app: `APP_ENV=production`, `PLATFORM_DOMAIN=<your-domain>`.
4. **Legal:** `/legal/*` pages ka lawyer se review karwaiye, aur GSTIN sahi daaliye.
5. Uptime monitor (UptimeRobot / Better Stack) lagaiye `https://<your-domain>/healthz` par.
6. `npm run preflight -- https://<your-domain> --hospital=main` → koi ✗ nahi. Control panel → Launch checklist bhi
   poori hari ho.
7. Soft launch: 1–2 jaan-pehchaan clinics, 2–4 hafte, aur **System health** roz dekhiye (GO_LIVE.md step 10).

## Kuch galat ho jaaye to

| Dikkat | Kya kariye |
|---|---|
| Purana version wapas chahiye | Coolify → Deployments → pichhla deployment **Redeploy** |
| Login ke baad "not linked to a hospital" | Kya email confirm hua? Kya `?hospital=<slug>` sahi hai? Owner email Step 1.3 se match karta hai? |
| Messages *failed* | Delivery log mein reason padhiye → Edge Function secrets check kariye → `notify` function ke **Logs** dekhiye |
| Razorpay payment ho gaya par plan update nahi hua | Razorpay → Webhooks → delivery logs; webhook secret aur URL dobara check kariye |
| Database update ke baad kuch toota | `supabase/upgrade-2026-10.sql` dobara chalaiye (yeh safe hai) |
| Data loss | Supabase → Database → Backups se restore, ya Step F ka encrypted backup |

---

**Har step ke baad:** step number aur ✅ Check ka result batayein (jaise "Step 3 done, chaaron functions Active"),
taaki agla step saath mein kar sakein.
