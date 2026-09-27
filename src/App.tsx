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

const Dashboard = lazy(() => import('./pages/dashboard/Dashboard'))
const PatientDetail = lazy(() => import('./pages/PatientDetail'))
const MyRecord = lazy(() => import('./pages/PatientDetail').then((m) => ({ default: m.MyRecord })))
const InvoiceDetail = lazy(() => import('./pages/InvoiceDetail'))
const PrescriptionView = lazy(() => import('./pages/PrescriptionView'))
const BedsPage = lazy(() => import('./pages/Beds'))
const Reports = lazy(() => import('./pages/Reports'))
const Settings = lazy(() => import('./pages/Settings'))

const RESOURCES = [
  R.patientsRes, R.appointmentsRes, R.prescriptionsRes, R.labTestsRes, R.admissionsRes, R.doctorsRes, R.staffRes,
  R.departmentsRes, R.invoicesRes, R.paymentsRes, R.expensesRes, R.inventoryRes, R.noticesRes, R.usersRes,
]

const PageLoader = () => <div className="grid h-64 place-items-center"><Spinner className="h-6 w-6" /></div>

export default function App() {
  return (
    <Suspense fallback={<FullScreenLoader />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<Suspense fallback={<PageLoader />}><Dashboard /></Suspense>} />
          {RESOURCES.map((def) => (
            <Route key={def.path} path={def.path} element={<RequireNav path={def.path}><ResourcePage key={def.path} def={def} /></RequireNav>} />
          ))}
          <Route path="/me" element={<RequireNav path="/me"><Suspense fallback={<PageLoader />}><MyRecord /></Suspense></RequireNav>} />
          <Route path="/patients/:id" element={<Suspense fallback={<PageLoader />}><PatientDetail /></Suspense>} />
          <Route path="/invoices/:id" element={<Suspense fallback={<PageLoader />}><InvoiceDetail /></Suspense>} />
          <Route path="/prescriptions/:id" element={<Suspense fallback={<PageLoader />}><PrescriptionView /></Suspense>} />
          <Route path="/beds" element={<RequireNav path="/beds"><Suspense fallback={<PageLoader />}><BedsPage /></Suspense></RequireNav>} />
          <Route path="/reports" element={<RequireNav path="/reports"><Suspense fallback={<PageLoader />}><Reports /></Suspense></RequireNav>} />
          <Route path="/settings" element={<Suspense fallback={<PageLoader />}><Settings /></Suspense>} />
          <Route path="*" element={<EmptyState className="py-24" icon={<Compass className="h-6 w-6" />} title="Page not found" description="The page you're looking for doesn't exist." action={<Link to="/"><Button>Go to dashboard</Button></Link>} />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
