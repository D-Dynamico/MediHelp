import { Placeholder as PlaceholderPage } from '../components/ui';

/**
 * The 404, and anything else that is a dead end.
 *
 * It offers a way out, which is the whole difference between an error page and
 * a wall. The shared component underneath is the same one the error boundary
 * and the offline state use.
 */
export function Placeholder({
  title,
  message = 'That page does not exist, or it has moved.',
}: {
  title: string;
  message?: string;
}) {
  return (
    <PlaceholderPage
      title={title}
      message={message}
      action={{ label: 'Find a doctor', to: '/' }}
    />
  );
}
