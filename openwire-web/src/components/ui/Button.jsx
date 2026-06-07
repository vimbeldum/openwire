import './ui.css';

function joinClasses(...classes) {
  return classes.filter(Boolean).join(' ');
}

export default function Button({
  className,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  leadingIcon,
  trailingIcon,
  children,
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      className={joinClasses(
        'ui-button',
        `ui-button--${variant}`,
        `ui-button--${size}`,
        fullWidth && 'ui-button--full-width',
        loading && 'ui-button--loading',
        className,
      )}
      aria-busy={loading || undefined}
      {...props}
    >
      {leadingIcon ? <span className="ui-button__icon">{leadingIcon}</span> : null}
      <span className="ui-button__label">{children}</span>
      {trailingIcon ? <span className="ui-button__icon">{trailingIcon}</span> : null}
    </button>
  );
}
