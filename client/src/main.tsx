import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './routes/router';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './components/ui';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root is missing from index.html');

createRoot(rootElement).render(
  <StrictMode>
    <AuthProvider>
      {/* Above the router: a toast raised by one screen has to survive the
          navigation that screen triggers - "Appointment booked" is shown on the
          appointments page, not on the doctor page that booked it. */}
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthProvider>
  </StrictMode>,
);
