import { createBrowserRouter } from 'react-router-dom';
import { Home } from '../pages/Home';
import { Login } from '../pages/auth/Login';
import { Signup } from '../pages/auth/Signup';
import { GuestOnlyRoute, ProtectedRoute, RoleRoute } from './guards';
import { Placeholder } from '../pages/Placeholder';

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
    children: [{ path: '/admin', element: <Placeholder title="Admin dashboard" /> }],
  },

  { path: '*', element: <Placeholder title="Page not found" /> },
]);
