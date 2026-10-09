import { Suspense, lazy, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { Role } from '@cleanloop/shared';
import { PhoneShell } from './components/Shell';
import { Skeleton } from './components/ui';
import { HOME_PATH } from './lib/config';
import { useSession } from './lib/session';
import Login from './pages/Login';

const LANDING_PATH = '/landing.html';

// Each role's screens load on demand, so residents never download the officer dashboard.
const ResidentHome = lazy(() => import('./pages/resident/Home'));
const Snap = lazy(() => import('./pages/resident/Snap'));
const Track = lazy(() => import('./pages/resident/Track'));
const Report = lazy(() => import('./pages/resident/Report'));
const Reports = lazy(() => import('./pages/resident/Reports'));
const Pickup = lazy(() => import('./pages/resident/Pickup'));
const Pickups = lazy(() => import('./pages/resident/Pickups'));
const Impact = lazy(() => import('./pages/resident/Impact'));
const Notifications = lazy(() => import('./pages/resident/Notifications'));
const Profile = lazy(() => import('./pages/Profile'));
const DriverRoute = lazy(() => import('./pages/driver/Route'));
const DriverMap = lazy(() => import('./pages/driver/RouteMap'));
const Overview = lazy(() => import('./pages/officer/Overview'));
const OfficerReports = lazy(() => import('./pages/officer/Reports'));
const OfficerMap = lazy(() => import('./pages/officer/MapPage'));
const OfficerRoutes = lazy(() => import('./pages/officer/Routes'));
const Risk = lazy(() => import('./pages/officer/Risk'));
const Recyclers = lazy(() => import('./pages/officer/Recyclers'));
const Requests = lazy(() => import('./pages/recycler/Requests'));
const Jobs = lazy(() => import('./pages/recycler/Jobs'));
const ShopProfile = lazy(() => import('./pages/recycler/ShopProfile'));

function Loading() {
  return (
    <div className="page" style={{ maxWidth: 480, margin: '0 auto', paddingTop: 24 }}>
      <Skeleton height={48} />
      <Skeleton height={160} />
      <Skeleton height={110} />
    </div>
  );
}

/** Signed-in users of the right role only; everyone else goes to their own home or login. */
function Guard({ role, children }: { role: Role; children: ReactNode }) {
  const { session } = useSession();
  if (!session) return <Navigate to="/login" replace />;
  if (session.user.role !== role) return <Navigate to={HOME_PATH[session.user.role]} replace />;
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}

function Phone({ role, children }: { role: Exclude<Role, 'officer'>; children: ReactNode }) {
  return (
    <Guard role={role}>
      <PhoneShell role={role}>
        <Suspense fallback={<Loading />}>{children}</Suspense>
      </PhoneShell>
    </Guard>
  );
}

/** Signed-in users go to their role's home; visitors see the public landing page. */
function Home() {
  const { session } = useSession();
  if (!session) {
    window.location.replace(LANDING_PATH);
    return null;
  }
  return <Navigate to={HOME_PATH[session.user.role]} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />

        <Route
          path="/resident"
          element={
            <Phone role="resident">
              <ResidentHome />
            </Phone>
          }
        />
        <Route
          path="/resident/snap"
          element={
            <Phone role="resident">
              <Snap />
            </Phone>
          }
        />
        <Route
          path="/resident/track"
          element={
            <Phone role="resident">
              <Track />
            </Phone>
          }
        />
        <Route
          path="/resident/report"
          element={
            <Phone role="resident">
              <Report />
            </Phone>
          }
        />
        <Route
          path="/resident/reports"
          element={
            <Phone role="resident">
              <Reports />
            </Phone>
          }
        />
        <Route
          path="/resident/pickup"
          element={
            <Phone role="resident">
              <Pickup />
            </Phone>
          }
        />
        <Route
          path="/resident/pickups"
          element={
            <Phone role="resident">
              <Pickups />
            </Phone>
          }
        />
        <Route
          path="/resident/impact"
          element={
            <Phone role="resident">
              <Impact />
            </Phone>
          }
        />
        <Route
          path="/resident/alerts"
          element={
            <Phone role="resident">
              <Notifications />
            </Phone>
          }
        />
        <Route
          path="/resident/profile"
          element={
            <Phone role="resident">
              <Profile />
            </Phone>
          }
        />

        <Route
          path="/driver"
          element={
            <Phone role="driver">
              <DriverRoute />
            </Phone>
          }
        />
        <Route
          path="/driver/map"
          element={
            <Phone role="driver">
              <DriverMap />
            </Phone>
          }
        />
        <Route
          path="/driver/profile"
          element={
            <Phone role="driver">
              <Profile />
            </Phone>
          }
        />

        <Route
          path="/officer"
          element={
            <Guard role="officer">
              <Overview />
            </Guard>
          }
        />
        <Route
          path="/officer/reports"
          element={
            <Guard role="officer">
              <OfficerReports />
            </Guard>
          }
        />
        <Route
          path="/officer/map"
          element={
            <Guard role="officer">
              <OfficerMap />
            </Guard>
          }
        />
        <Route
          path="/officer/routes"
          element={
            <Guard role="officer">
              <OfficerRoutes />
            </Guard>
          }
        />
        <Route
          path="/officer/risk"
          element={
            <Guard role="officer">
              <Risk />
            </Guard>
          }
        />
        <Route
          path="/officer/recyclers"
          element={
            <Guard role="officer">
              <Recyclers />
            </Guard>
          }
        />

        <Route
          path="/recycler"
          element={
            <Phone role="recycler">
              <Requests />
            </Phone>
          }
        />
        <Route
          path="/recycler/jobs"
          element={
            <Phone role="recycler">
              <Jobs />
            </Phone>
          }
        />
        <Route
          path="/recycler/profile"
          element={
            <Phone role="recycler">
              <ShopProfile />
            </Phone>
          }
        />

        <Route path="*" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}
