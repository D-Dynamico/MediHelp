import { createBrowserRouter } from 'react-router-dom';
import { Home } from '../pages/Home';
import { Login } from '../pages/auth/Login';
import { Signup } from '../pages/auth/Signup';
import { GuestOnlyRoute, ProtectedRoute, RoleRoute } from './guards';
import { Placeholder } from '../pages/Placeholder';
import { AdminLayout } from '../pages/admin/AdminLayout';
import { AdminDashboard } from '../pages/admin/Dashboard';
import { AdminDoctors } from '../pages/admin/Doctors';
import { AddDoctor } from '../pages/admin/AddDoctor';
import { AdminAppointments } from '../pages/admin/Appointments';

/**
 * Route groups by role. The guards keep people off pages that would only show
 * them errors; the server is what actually decides who may do what.
 */
export const router = createBrowserRouter([
  { path: '/', element: <Home /> },

  {
    element: <GuestOnlyRoute />,
    children: [
      { path: '/login', element: <Login /> },
      { path: '/signup', element: <Signup /> },
    ],
  },

  {
    element: <ProtectedRoute />,
    children: [{ path: '/account', element: <Placeholder title="Your account" /> }],
  },

  {
    element: <RoleRoute roles={['doctor']} />,
    children: [{ path: '/doctor', element: <Placeholder title="Doctor dashboard" /> }],
  },

  {
    element: <RoleRoute roles={['admin']} />,
    children: [
      {
        // A layout route: the sidebar is rendered once and survives navigation
        // between the sections inside it.
        element: <AdminLayout />,
        children: [
          { path: '/admin', element: <AdminDashboard /> },
          // Declared before '/admin/doctors/:id' would be, so "new" is not read
          // as an id when the edit route arrives.
          { path: '/admin/doctors/new', element: <AddDoctor /> },
          { path: '/admin/doctors', element: <AdminDoctors /> },
          { path: '/admin/appointments', element: <AdminAppointments /> },
        ],
      },
    ],
  },

  { path: '*', element: <Placeholder title="Page not found" /> },
]);
