"use client";

import { useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  ConfirmationDialog,
  DataTable,
  EmptyState,
  ErrorState,
  FileUpload,
  Input,
  MobileList,
  ProgressIndicator,
  Select,
  StatusBadge,
  Tabs,
  Textarea,
  Toggle,
  useToast,
} from "@/components/ui";

const demoRows = [
  { name: "Downtown", stations: 2, status: "Active" },
  { name: "Riverside", stations: 2, status: "Active" },
] as const;

export function FoundationDemo() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { notify } = useToast();
  return (
    <>
      <Tabs
        label="Foundation sections"
        items={[
          { href: "#controls", label: "Controls", active: true },
          { href: "#data", label: "Data" },
          { href: "#states", label: "States" },
        ]}
      />
      <section className="section-stack" id="controls" aria-labelledby="controls-title">
        <div>
          <p className="eyebrow">Reusable components</p>
          <h2 id="controls-title">Form controls</h2>
        </div>
        <Card className="form-grid">
          <Input
            id="sop-title"
            label="SOP title"
            placeholder="Example: Opening the grill"
            hint="Use a short, clear title."
          />
          <Select id="station" label="Station" defaultValue="">
            <option value="" disabled>
              Select a station
            </option>
            <option>Grill</option>
            <option>Fry Station</option>
          </Select>
          <Textarea
            id="description"
            label="Description"
            placeholder="Describe what the employee will learn."
          />
          <div className="control-stack">
            <Toggle id="required" label="Training required" />
            <Checkbox id="confirmation" label="Require step confirmation" />
          </div>
          <FileUpload id="reference-file" label="Add reference media" accept="image/*,video/*" />
          <div className="button-row">
            <Button onClick={() => notify("Draft status saved", "success")}>
              Show success message
            </Button>
            <Button variant="secondary" onClick={() => setDialogOpen(true)}>
              Open confirmation
            </Button>
          </div>
        </Card>
      </section>
      <section className="section-stack" id="data" aria-labelledby="data-title">
        <div>
          <p className="eyebrow">Responsive data</p>
          <h2 id="data-title">Locations</h2>
        </div>
        <Card>
          <div className="desktop-only">
            <DataTable
              caption="Demo locations"
              rows={demoRows}
              getRowKey={(row) => row.name}
              columns={[
                { key: "name", header: "Location", render: (row) => row.name },
                { key: "stations", header: "Stations", render: (row) => row.stations },
                {
                  key: "status",
                  header: "Status",
                  render: () => <StatusBadge tone="success">Active</StatusBadge>,
                },
              ]}
            />
          </div>
          <MobileList label="Demo locations" className="mobile-only">
            {demoRows.map((row) => (
              <li key={row.name}>
                <div>
                  <strong>{row.name}</strong>
                  <span>{row.stations} stations</span>
                </div>
                <StatusBadge tone="success">{row.status}</StatusBadge>
              </li>
            ))}
          </MobileList>
          <ProgressIndicator value={68} label="Foundation coverage" />
        </Card>
      </section>
      <section className="section-stack" id="states" aria-labelledby="states-title">
        <div>
          <p className="eyebrow">Application states</p>
          <h2 id="states-title">Clear next steps</h2>
        </div>
        <div className="state-grid">
          <EmptyState
            title="Nothing here yet"
            description="Create the first record when this feature is available."
          />
          <ErrorState title="Couldn’t save" description="Check your connection and try again." />
        </div>
      </section>
      <ConfirmationDialog
        open={dialogOpen}
        title="Confirm this action"
        description="Confirmation dialogs explain the permanent result before continuing."
        confirmLabel="Confirm"
        tone="primary"
        onCancel={() => setDialogOpen(false)}
        onConfirm={() => {
          setDialogOpen(false);
          notify("Action confirmed", "success");
        }}
      />
    </>
  );
}
