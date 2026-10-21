"use client";
import * as React from "react";
import { Input } from "./input";
import { Checkbox } from "./checkbox";
/** Compatibility adapter for existing controlled forms; visual and keyboard behavior use shadcn. */
export function FormInput(props: React.ComponentProps<"input">) {
  if (props.type !== "checkbox") return <Input {...props} />;
  const {
    onChange,
    checked,
    defaultChecked,
    disabled,
    id,
    name,
    value,
    className,
    required,
    "aria-label": label,
  } = props;
  return (
    <Checkbox
      checked={checked}
      defaultChecked={defaultChecked}
      disabled={disabled}
      id={id}
      name={name}
      value={String(value ?? "on")}
      className={className}
      required={required}
      aria-label={label}
      onCheckedChange={(v) =>
        onChange?.({
          target: { checked: v === true, name, value },
          currentTarget: { checked: v === true, name, value },
        } as React.ChangeEvent<HTMLInputElement>)
      }
    />
  );
}
