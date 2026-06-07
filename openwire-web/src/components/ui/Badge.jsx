import './ui.css';

function joinClasses(...classes) {
  return classes.filter(Boolean).join(' ');
}

export default function Badge({
  className,
  tone = 'neutral',
  children,
  ...props
}) {
  return (
    <span className={joinClasses('ui-badge', `ui-badge--${tone}`, className)} {...props}>
      {children}
    </span>
  );
}
