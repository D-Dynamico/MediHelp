import { createBrowserRouter } from 'react-router-dom';
import { Home } from '../pages/Home';

/**
 * Route groups are added per role in later phases (patient, doctor, admin),
 * each wrapped in the guards from phase 3.
 */
export const router = createBrowserRouter([
  { path: '/', element: <Home /> },
]);
