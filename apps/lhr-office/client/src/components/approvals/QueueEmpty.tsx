export function QueueEmpty({ children = 'Nothing pending' }: { children?: string }) {
  return <p className="queue-empty">{children}</p>;
}
