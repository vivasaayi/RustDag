import React, { useEffect, useMemo, useRef, useState } from 'react';

export default function HeadlessSelect({
  value,
  onValueChange,
  options,
  placeholder = 'Select',
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const selected = useMemo(
    () => options.find((option) => option.value === value) || null,
    [options, value]
  );

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const onEsc = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div className={`hf-select ${className}`} ref={rootRef}>
      <button
        type="button"
        className="hf-select-trigger"
        aria-label={placeholder}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>{selected?.label || placeholder}</span>
        <span className="hf-select-icon">▼</span>
      </button>
      {open && (
        <div className="hf-select-content" role="listbox">
          <div className="hf-select-viewport">
            {options.map((option) => {
              const isChecked = option.value === value;
              return (
                <button
                  type="button"
                  key={option.value}
                  className={`hf-select-item ${isChecked ? 'checked' : ''}`}
                  onClick={() => {
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span>{option.label}</span>
                  {isChecked && <span className="hf-select-check">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
