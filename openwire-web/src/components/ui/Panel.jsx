import './ui.css';

function joinClasses(...classes) {
  return classes.filter(Boolean).join(' ');
}

export default function Panel({
  as: Component = 'div',
  className,
  tone = 'default',
  padding = 'md',
  children,
  ...props
}) {
  return (
    <Component
      className={joinClasses('ui-panel', `ui-panel--${tone}`, `ui-panel--${padding}`, className)}
      {...props}
    >
      {children}
    </Component>
  );
}
