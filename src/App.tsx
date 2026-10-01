import { lazy, Suspense } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { AppLayout } from './components/layout/AppLayout'
import { FullScreenLoader, RequireAuth, RequireNav } from './components/layout/Guards'
import { ResourcePage } from './components/ResourcePage'
import { Button, EmptyState, Spinner } from './components/ui'
import * as R from './resources/definitions'
import Login from './pages/Login'
import Register from './pages/Register'
const ForgotPassword = lazy(() => import('./pages/PasswordReset').then((m) => ({ default: m.ForgotPassword })))
const ResetPassword = lazy(() => import('./pages/PasswordReset').then((m) => ({ default: m.ResetPassword })))
import { InviteStaff } from './pages/users/InviteStaff'

// Public website
const SiteLayout = lazy(() => import('./site/SiteLayout'))
const SiteHome = lazy(() => import('./site/pages/Home'))
const SiteNotFound = lazy(() => import('./site/pages/NotFound'))
const PUBLIC_PAGES: [string, React.LazyExoticComponent<() => JSX.Element>][] = [
  ['/welcome', SiteHome],
  ['/about', lazy(() => import('./site/pages/About'))],
  ['/services', lazy(() => import('./site/pages/Services'))],
  ['/services/:slug', lazy(() => import('./site/pages/ServiceDetail'))],
  ['/find-a-doctor', lazy(() => import('./site/pages/FindDoctor'))],
  ['/find-a-doctor/:slug', lazy(() => import('./site/pages/DoctorProfile'))],
  ['/packages', lazy(() => import('./site/pages/Packages'))],
  ['/contact', lazy(() => import('./site/pages/Contact'))],
  ['/faq', lazy(() => import('./site/pages/Faq'))],
  ['/privacy', lazy(() => import('./site/pages/Legal').then((m) => ({ default: m.Privacy })))],
  ['/terms', lazy(() => import('./site/pages/Legal').then((m) => ({ default: m.Terms })))],
  ['/book', lazy(() => import('./site/pages/Book'))],
  ['/feedback/:id', lazy(() => import('./site/pages/Feedback'))],
  ['/forms/:slug', lazy(() => import('./site/pages/FormPage'))],
]
const Dashboard = lazy(() => import('./pages/dashboard/Dashboard'))
const PatientDetail = lazy(() => import('./pages/PatientDetail'))
const MyRecord = lazy(() => import('./pages/PatientDetail').then((m) => ({ default: m.MyRecord })))
const InvoiceDetail = lazy(() => import('./pages/InvoiceDetail'))
const PrescriptionView = lazy(() => import('./pages/PrescriptionView'))
const BedsPage = lazy(() => import('./pages/Beds'))
const Reports = lazy(() => import('./pages/Reports'))
const Settings = lazy(() => import('./pages/settings/SettingsPage'))
const CmsPage = lazy(() => import('./pages/cms/CmsPage'))
const AppointmentsPage = lazy(() => import('./pages/appointments/AppointmentsPage'))
const SchedulePage = lazy(() => import('./pages/SchedulePage'))
const AuditPage = lazy(() => import('./pages/AuditPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const RatingsPage = lazy(() => import('./pages/RatingsPage'))
const EnquiriesPage = lazy(() => import('./pages/EnquiriesPage'))
const NoticeBoard = lazy(() => import('./pages/NoticeBoard'))

const RESOURCES = [
  R.patientsRes, R.appointmentsRes, R.prescriptionsRes, R.labTestsRes, R.admissionsRes, R.doctorsRes, R.staffRes,
  R.departmentsRes, R.invoicesRes, R.paymentsRes, R.expensesRes, R.inventoryRes, R.noticesRes, R.usersRes,
]

/** Paths that belong to the signed-in app; anything else a guest opens gets the public 404. */
const APP_PREFIXES = [...RESOURCES.map((r) => r.path), '/me', '/patients', '/invoices', '/prescriptions', '/beds', '/reports', '/settings', '/cms', '/schedule', '/audit', '/profile', '/ratings', '/enquiries']
const isAppPath = (p: string) => APP_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`))

const PageLoader = () => <div className="grid h-64 place-items-center"><Spinner className="h-6 w-6" /></div>

export default function App() {
  return (
    <Suspense fallback={<FullScreenLoader />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route element={<SiteLayout />}>
          {PUBLIC_PAGES.map(([path, Page]) => <Route key={path} path={path} element={<Page />} />)}
        </Route>
        <Route element={
          <RequireAuth
            guestHome={<SiteLayout><SiteHome /></SiteLayout>}
            guestFallback={(p) => (isAppPath(p) ? null : <SiteLayout><SiteNotFound /></SiteLayout>)}
          >
            <AppLayout />
          </RequireAuth>
        }>
          <Route index element={<Suspense fallback={<PageLoader />}><Dashboard /></Suspense>} />
          <Route path="/appointments" element={<RequireNav path="/appointments"><Suspense fallback={<PageLoader />}><AppointmentsPage /></Suspense></RequireNav>} />
          {RESOURCES.filter((def) => def !== R.appointmentsRes && def !== R.noticesRes).map((def) => (
            <Route key={def.path} path={def.path} element={<RequireNav path={def.path}><ResourcePage key={def.path} def={def} headerExtra={def === R.usersRes ? <InviteStaff /> : undefined} /></RequireNav>} />
          ))}
          <Route path="/notices" element={<RequireNav path="/notices"><Suspense fallback={<PageLoader />}><NoticeBoard /></Suspense></RequireNav>} />
          <Route path="/me" element={<RequireNav path="/me"><Suspense fallback={<PageLoader />}><MyRecord /></Suspense></RequireNav>} />
          <Route path="/patients/:id" element={<Suspense fallback={<PageLoader />}><PatientDetail /></Suspense>} />
          <Route path="/invoices/:id" element={<Suspense fallback={<PageLoader />}><InvoiceDetail /></Suspense>} />
          <Route path="/prescriptions/:id" element={<Suspense fallback={<PageLoader />}><PrescriptionView /></Suspense>} />
          <Route path="/beds" element={<RequireNav path="/beds"><Suspense fallback={<PageLoader />}><BedsPage /></Suspense></RequireNav>} />
          <Route path="/reports" element={<RequireNav path="/reports"><Suspense fallback={<PageLoader />}><Reports /></Suspense></RequireNav>} />
          <Route path="/cms" element={<RequireNav path="/cms"><Suspense fallback={<PageLoader />}><CmsPage /></Suspense></RequireNav>} />
          <Route path="/schedule" element={<RequireNav path="/schedule"><Suspense fallback={<PageLoader />}><SchedulePage /></Suspense></RequireNav>} />
          <Route path="/audit" element={<RequireNav path="/audit"><Suspense fallback={<PageLoader />}><AuditPage /></Suspense></RequireNav>} />
          <Route path="/ratings" element={<RequireNav path="/ratings"><Suspense fallback={<PageLoader />}><RatingsPage /></Suspense></RequireNav>} />
          <Route path="/enquiries" element={<RequireNav path="/enquiries"><Suspense fallback={<PageLoader />}><EnquiriesPage /></Suspense></RequireNav>} />
          <Route path="/profile" element={<Suspense fallback={<PageLoader />}><ProfilePage /></Suspense>} />
          <Route path="/settings" element={<Suspense fallback={<PageLoader />}><Settings /></Suspense>} />
          <Route path="*" element={<EmptyState className="py-24" icon={<Compass className="h-6 w-6" />} title="Page not found" description="The page you're looking for doesn't exist." action={<Link to="/"><Button>Go to dashboard</Button></Link>} />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
