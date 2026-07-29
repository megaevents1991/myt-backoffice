"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  GripVertical,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  CHOICE_TYPES,
  FIELD_TYPE_LABELS,
  FORM_FIELD_TYPES,
  TEXTUAL_TYPES,
} from "@/types/form.types";
import type {
  FormFieldDraft,
  FormFieldOption,
  FormFieldType,
} from "@/types/form.types";
import { BilingualInput } from "./bilingual-input";

/**
 * Option values are the strings stored in `form_responses.answers`, so they are
 * generated once from the English label and then never change — renaming a
 * label must not orphan answers already collected.
 */
function optionValueFrom(labelEn: string, index: number): string {
  const slug = labelEn
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || `option-${index + 1}`;
}

type Props = {
  field: FormFieldDraft;
  index: number;
  total: number;
  onChange: (patch: Partial<FormFieldDraft>) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

export function FieldEditor({
  field,
  index,
  total,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
}: Props) {
  const [open, setOpen] = useState(field.label_en.trim() === "");

  const isChoice = CHOICE_TYPES.includes(field.type);
  const isTextual = TEXTUAL_TYPES.includes(field.type);
  const isSection = field.type === "section";

  function setOption(optionIndex: number, patch: Partial<FormFieldOption>) {
    const options = field.options.map((option, i) =>
      i === optionIndex ? { ...option, ...patch } : option,
    );
    onChange({ options });
  }

  function addOption() {
    onChange({
      options: [
        ...field.options,
        { value: "", label_en: "", label_he: null },
      ],
    });
  }

  function removeOption(optionIndex: number) {
    onChange({ options: field.options.filter((_, i) => i !== optionIndex) });
  }

  function setConfig(patch: Record<string, number | undefined>) {
    onChange({ config: { ...field.config, ...patch } });
  }

  return (
    <div className={cn("rounded-lg border bg-card", open && "ring-1 ring-border")}>
      <div className="flex items-center gap-2 p-3">
        <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate text-sm font-medium">
            {field.label_en.trim() || <span className="text-muted-foreground">Untitled question</span>}
          </span>
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {FIELD_TYPE_LABELS[field.type]}
          </Badge>
          {field.required && !isSection && (
            <span className="shrink-0 text-destructive" title="Required">
              *
            </span>
          )}
        </button>

        <div className="flex shrink-0 items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label="Move up"
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            aria-label="Move down"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={onDuplicate} aria-label="Duplicate">
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-destructive"
            onClick={onDelete}
            aria-label="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {open && (
        <div className="space-y-4 border-t p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Type</Label>
              <Select
                value={field.type}
                onValueChange={(next) => onChange({ type: next as FormFieldType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORM_FIELD_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {FIELD_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!isSection && (
              <div className="flex items-end gap-2 pb-2">
                <Switch
                  id={`req-${field.id}`}
                  checked={field.required}
                  onCheckedChange={(checked) => onChange({ required: checked })}
                />
                <Label htmlFor={`req-${field.id}`} className="text-sm">
                  Required
                </Label>
              </div>
            )}
          </div>

          <BilingualInput
            label={isSection ? "Section title" : "Question"}
            required
            valueEn={field.label_en}
            valueHe={field.label_he ?? ""}
            onChangeEn={(value) => onChange({ label_en: value })}
            onChangeHe={(value) => onChange({ label_he: value || null })}
          />

          <BilingualInput
            label="Helper text"
            valueEn={field.help_en ?? ""}
            valueHe={field.help_he ?? ""}
            onChangeEn={(value) => onChange({ help_en: value || null })}
            onChangeHe={(value) => onChange({ help_he: value || null })}
          />

          {isTextual && (
            <BilingualInput
              label="Placeholder"
              valueEn={field.placeholder_en ?? ""}
              valueHe={field.placeholder_he ?? ""}
              onChangeEn={(value) => onChange({ placeholder_en: value || null })}
              onChangeHe={(value) => onChange({ placeholder_he: value || null })}
            />
          )}

          {isChoice && (
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">Options</Label>
              {field.options.map((option, optionIndex) => (
                <div key={optionIndex} className="flex items-center gap-2">
                  <Input
                    className="flex-1"
                    placeholder="Option (English)"
                    value={option.label_en}
                    onChange={(e) => setOption(optionIndex, { label_en: e.target.value })}
                    onBlur={() => {
                      if (!option.value) {
                        setOption(optionIndex, {
                          value: optionValueFrom(option.label_en, optionIndex),
                        });
                      }
                    }}
                  />
                  <Input
                    className="flex-1 text-right"
                    dir="rtl"
                    placeholder="אפשרות (עברית)"
                    value={option.label_he ?? ""}
                    onChange={(e) =>
                      setOption(optionIndex, { label_he: e.target.value || null })
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeOption(optionIndex)}
                    aria-label="Remove option"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addOption}>
                <Plus className="mr-2 h-4 w-4" />
                Add option
              </Button>
            </div>
          )}

          {field.type === "rating" && (
            <NumberConfig
              label="Number of stars"
              value={field.config.max ?? 5}
              min={3}
              max={10}
              onChange={(max) => setConfig({ max })}
            />
          )}

          {field.type === "scale" && (
            <div className="grid grid-cols-2 gap-4">
              <NumberConfig
                label="From"
                value={field.config.min ?? 1}
                min={0}
                max={9}
                onChange={(min) => setConfig({ min })}
              />
              <NumberConfig
                label="To"
                value={field.config.max ?? 10}
                min={2}
                max={10}
                onChange={(max) => setConfig({ max })}
              />
            </div>
          )}

          {field.type === "number" && (
            <div className="grid grid-cols-3 gap-4">
              <NumberConfig
                label="Min"
                value={field.config.min}
                onChange={(min) => setConfig({ min })}
                allowEmpty
              />
              <NumberConfig
                label="Max"
                value={field.config.max}
                onChange={(max) => setConfig({ max })}
                allowEmpty
              />
              <NumberConfig
                label="Step"
                value={field.config.step}
                onChange={(step) => setConfig({ step })}
                allowEmpty
              />
            </div>
          )}

          {field.type === "long_text" && (
            <NumberConfig
              label="Box height (rows)"
              value={field.config.rows ?? 4}
              min={2}
              max={12}
              onChange={(rows) => setConfig({ rows })}
            />
          )}
        </div>
      )}
    </div>
  );
}

function NumberConfig({
  label,
  value,
  min,
  max,
  onChange,
  allowEmpty = false,
}: {
  label: string;
  value: number | undefined;
  min?: number;
  max?: number;
  onChange: (value: number | undefined) => void;
  allowEmpty?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        value={value === undefined ? "" : String(value)}
        onChange={(e) => {
          if (e.target.value === "") {
            onChange(allowEmpty ? undefined : min);
            return;
          }
          onChange(Number(e.target.value));
        }}
      />
    </div>
  );
}
