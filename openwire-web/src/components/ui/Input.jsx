import './ui.css';

function joinClasses(...classes) {
  return classes.filter(Boolean).join(' ');
}

export default function Input({
  className,
  inputClassName,
  label,
  hint,
  invalid = false,
  error,
  id,
  ...props
}) {
  const describedBy = [props['aria-describedby'], hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <label className={joinClasses('ui-field', className)}>
      {label ? <span className="ui-field__label">{label}</span> : null}
      <input
        id={id}
        className={joinClasses('ui-input', invalid && 'ui-input--invalid', inputClassName)}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {hint ? <span id={id ? `${id}-hint` : undefined} className="ui-field__hint">{hint}</span> : null}
      {error ? <span id={id ? `${id}-error` : undefined} className="ui-field__error">{error}</span> : null}
    </label>
  );
}
