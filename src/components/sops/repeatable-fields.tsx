"use client";

import { Button, Card, Input, Select } from "@/components/ui";

export interface MaterialRow {
  kind: "material" | "ingredient";
  name: string;
  quantity: string;
  unit: string;
}

export interface WarningRow {
  text: string;
}

export function MaterialsFields({
  materials,
  onChange,
  disabled,
}: {
  materials: readonly MaterialRow[];
  onChange: (rows: MaterialRow[]) => void;
  disabled?: boolean;
}) {
  return (
    <Card className="form-section">
      <h2>Materials and ingredients</h2>
      {materials.map((material, index) => (
        <div className="repeatable-row" key={index}>
          <Select
            id={`material-kind-${index}`}
            label="Type"
            value={material.kind}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                materials.map((row, rowIndex) =>
                  rowIndex === index
                    ? { ...row, kind: event.target.value as MaterialRow["kind"] }
                    : row,
                ) as MaterialRow[],
              )
            }
          >
            <option value="material">Material</option>
            <option value="ingredient">Ingredient</option>
          </Select>
          <Input
            id={`material-name-${index}`}
            label="Name"
            value={material.name}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                materials.map((row, rowIndex) =>
                  rowIndex === index ? { ...row, name: event.target.value } : row,
                ) as MaterialRow[],
              )
            }
          />
          <Input
            id={`material-quantity-${index}`}
            label="Quantity"
            value={material.quantity}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                materials.map((row, rowIndex) =>
                  rowIndex === index ? { ...row, quantity: event.target.value } : row,
                ) as MaterialRow[],
              )
            }
          />
          <Input
            id={`material-unit-${index}`}
            label="Unit"
            value={material.unit}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                materials.map((row, rowIndex) =>
                  rowIndex === index ? { ...row, unit: event.target.value } : row,
                ) as MaterialRow[],
              )
            }
          />
          {!disabled && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => onChange(materials.filter((_, rowIndex) => rowIndex !== index))}
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      {!disabled && (
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            onChange([...materials, { kind: "ingredient", name: "", quantity: "", unit: "" }])
          }
        >
          Add material or ingredient
        </Button>
      )}
    </Card>
  );
}

export function WarningsFields({
  warnings,
  onChange,
  disabled,
}: {
  warnings: readonly WarningRow[];
  onChange: (rows: WarningRow[]) => void;
  disabled?: boolean;
}) {
  return (
    <Card className="form-section">
      <h2>Warnings</h2>
      {warnings.map((warning, index) => (
        <div className="repeatable-row" key={index}>
          <Input
            id={`warning-${index}`}
            label="Warning"
            value={warning.text}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                warnings.map((row, rowIndex) =>
                  rowIndex === index ? { text: event.target.value } : row,
                ) as WarningRow[],
              )
            }
          />
          {!disabled && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => onChange(warnings.filter((_, rowIndex) => rowIndex !== index))}
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      {!disabled && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => onChange([...warnings, { text: "" }])}
        >
          Add warning
        </Button>
      )}
    </Card>
  );
}
