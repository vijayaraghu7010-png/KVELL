import React, { useMemo, useState } from 'react';
import type { WardenTabProps } from './WardenPortal';
import type { WardenRoomRecord } from '../../types';
import { http } from '../../services/http';
import { useAction, useResource } from '../../hooks/useApi';
import { AsyncContent, Badge, Button, Card, ConfirmDialog, DataTable, FilterSelect, KeyValue, Modal, PageHeader, SelectField, StatCard, StudentPicker, TextField } from '../common/ui';

type Room = WardenRoomRecord & { amenities: string[] };
interface Unallocated {
  id: string;
  name: string;
  regNumber: string;
  department: string;
  year: string;
  gender: string;
}

export const WardenRoomAllocation: React.FC<WardenTabProps> = ({ onShowToast }) => {
  const rooms = useResource(() => http.get<Room[]>('/warden/rooms'));
  const [block, setBlock] = useState('');
  const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const all = rooms.data ?? [];
  const rows = useMemo(() => all.filter((r) => (!block || r.block === block) && (!status || r.status === status)), [all, block, status]);
  const capacity = all.reduce((s, r) => s + r.capacity, 0);
  const occupied = all.reduce((s, r) => s + r.occupied, 0);

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Rooms / Allocation"
        subtitle="Room inventory and occupants. Capacity is enforced when allocating."
        icon="single_bed"
        actions={
          <Button icon="add" onClick={() => setAdding(true)}>
            Add room
          </Button>
        }
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Total rooms" value={all.length} icon="meeting_room" />
        <StatCard label="Total capacity" value={capacity} icon="bed" tone="violet" />
        <StatCard label="Occupied beds" value={occupied} icon="person" tone="amber" hint={capacity ? `${Math.round((occupied / capacity) * 100)}% occupancy` : undefined} />
        <StatCard label="Available beds" value={capacity - occupied} icon="event_available" tone="green" />
      </div>
      <Card>
        <AsyncContent {...rooms} onRetry={rooms.reload}>
          {() => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              search={(r) => `${r.roomNumber} ${r.block} ${r.occupants.map((o) => `${o.name} ${o.regNumber}`).join(' ')}`}
              onRowClick={(r) => setOpenId(r.id)}
              emptyTitle="No rooms"
              emptyMessage="Add rooms to start allocating residents."
              toolbar={
                <>
                  <FilterSelect label="Block" value={block} onChange={setBlock} options={[...new Set(all.map((r) => r.block).filter(Boolean))].sort()} />
                  <FilterSelect label="Occupancy" value={status} onChange={setStatus} options={['Available', 'Partially Filled', 'Full']} />
                </>
              }
              columns={[
                { key: 'roomNumber', label: 'Room', render: (r) => <span className="font-semibold text-[var(--kv-heading)]">{r.roomNumber}</span> },
                { key: 'block', label: 'Block' },
                { key: 'floor', label: 'Floor' },
                { key: 'roomType', label: 'Type' },
                { key: 'occupied', label: 'Occupancy', render: (r) => `${r.occupied}/${r.capacity}` },
                { key: 'occupants', label: 'Occupants', render: (r) => <span className="text-xs">{r.occupants.map((o) => o.name).join(', ') || '—'}</span> },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'Full' ? 'red' : r.status === 'Available' ? 'green' : 'amber'}>{r.status}</Badge> },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      {adding && (
        <AddRoom
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            rooms.reload();
          }}
          onShowToast={onShowToast}
        />
      )}
      {openId && <RoomDetail room={all.find((r) => r.id === openId)!} onClose={() => setOpenId(null)} onChanged={rooms.reload} onShowToast={onShowToast} />}
    </div>
  );
};

const AddRoom: React.FC<{ onClose: () => void; onSaved: () => void; onShowToast: WardenTabProps['onShowToast'] }> = ({ onClose, onSaved, onShowToast }) => {
  const [f, setF] = useState({ roomNumber: '', floor: '1', capacity: '2', roomType: 'Double', amenities: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, pending } = useAction(onShowToast);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal
      open
      title="Add new hostel room"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={pending}
            onClick={async () => {
              const errs: Record<string, string> = {};
              if (!f.roomNumber.trim()) errs.roomNumber = 'Room number is required.';
              setErrors(errs);
              if (Object.keys(errs).length) return;
              const r = await run(() =>
                http.post('/warden/rooms', {
                  roomNumber: f.roomNumber.trim(),
                  floor: Number(f.floor),
                  capacity: Number(f.capacity),
                  roomType: f.roomType,
                  amenities: f.amenities
                    .split(',')
                    .map((a) => a.trim())
                    .filter(Boolean),
                }),
              );
              if (r) onSaved();
            }}
          >
            Add room
          </Button>
        </>
      }
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <TextField label="Room number" required value={f.roomNumber} onChange={set('roomNumber')} error={errors.roomNumber} placeholder="e.g. A-105" />
        <TextField label="Floor" type="number" min={0} max={50} value={f.floor} onChange={set('floor')} />
        <TextField label="Capacity (beds)" type="number" min={1} max={12} value={f.capacity} onChange={set('capacity')} />
        <SelectField label="Room type" value={f.roomType} onChange={set('roomType')} options={['Single', 'Double', 'Triple', 'Four Sharing', 'Shared']} />
        <TextField label="Amenities (comma-separated)" value={f.amenities} onChange={set('amenities')} placeholder="Study table, Wardrobe" />
      </div>
    </Modal>
  );
};

const RoomDetail: React.FC<{ room: Room; onClose: () => void; onChanged: () => void; onShowToast: WardenTabProps['onShowToast'] }> = ({ room, onClose, onChanged, onShowToast }) => {
  const candidates = useResource(() => http.get<Unallocated[]>('/warden/rooms/unallocated-students'));
  const allStudents = useResource(() => http.get<{ id: string; name: string; regNumber: string; roomNumber: string }[]>('/warden/students'));
  const [studentId, setStudentId] = useState('');
  const [mode, setMode] = useState<'new' | 'transfer'>('new');
  const [vacate, setVacate] = useState<{ id: string; name: string } | null>(null);
  const { run, pending } = useAction(onShowToast);
  const full = room.occupied >= room.capacity;
  const options =
    mode === 'new'
      ? (candidates.data ?? []).map((s) => ({ value: s.id, label: `${s.name} · ${s.regNumber} · ${s.department} ${s.year}` }))
      : (allStudents.data ?? []).filter((s) => s.roomNumber !== room.roomNumber && s.roomNumber !== 'Unallocated').map((s) => ({ value: s.id, label: `${s.name} · ${s.regNumber} (now in ${s.roomNumber})` }));

  return (
    <Modal open size="lg" title={`Room ${room.roomNumber}`} description={`${room.block} · Floor ${room.floor} · ${room.roomType}`} onClose={onClose}>
      <div className="space-y-5">
        <KeyValue
          cols={3}
          items={[
            ['Occupancy', `${room.occupied}/${room.capacity}`],
            ['Status', room.status],
            ['Amenities', room.amenities.join(', ') || '—'],
          ]}
        />
        <div>
          <h3 className="text-sm font-semibold text-[var(--kv-heading)] mb-2">Occupants</h3>
          {room.occupants.length === 0 ? (
            <p className="text-sm text-[var(--kv-text-muted)]">Room is empty.</p>
          ) : (
            <ul className="divide-y divide-[var(--kv-border-soft)] border border-[var(--kv-border)] rounded-lg">
              {room.occupants.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    <span className="font-semibold">{o.name}</span> <span className="text-[var(--kv-text-muted)]">· {o.regNumber} · {o.department} {o.year}</span>
                  </span>
                  <Button size="sm" variant="danger" onClick={() => setVacate({ id: o.id, name: o.name })}>
                    Vacate
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border border-[var(--kv-border)] rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-[var(--kv-heading)]">Allocate a student</h3>
            <div className="flex gap-1 text-xs">
              <Button size="sm" variant={mode === 'new' ? 'primary' : 'secondary'} onClick={() => (setMode('new'), setStudentId(''))}>
                Unallocated
              </Button>
              <Button size="sm" variant={mode === 'transfer' ? 'primary' : 'secondary'} onClick={() => (setMode('transfer'), setStudentId(''))}>
                Transfer from another room
              </Button>
            </div>
          </div>
          {full ? (
            <p className="text-sm text-rose-700">This room is full.</p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[260px]">
                <StudentPicker
                  label="Student"
                  value={studentId}
                  onChange={setStudentId}
                  options={options}
                  placeholder="Search by name, register number or department…"
                  emptyMessage={mode === 'new' ? 'Every student already has a room' : 'No other room has residents to transfer'}
                />
              </div>
              <Button
                icon="person_add"
                loading={pending}
                disabled={!studentId}
                onClick={async () => {
                  const r = await run(() => http.post(`/warden/rooms/${room.id}/allocate`, { studentId }));
                  if (r) {
                    setStudentId('');
                    onChanged();
                    onClose();
                  }
                }}
              >
                {mode === 'new' ? 'Allocate' : 'Transfer here'}
              </Button>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={!!vacate}
        title={`Remove ${vacate?.name} from ${room.roomNumber}?`}
        message="The student will appear under unallocated residents."
        reasonLabel="Reason (optional)"
        danger
        confirmLabel="Vacate"
        pending={pending}
        onClose={() => setVacate(null)}
        onConfirm={async (reason) => {
          const r = await run(() => http.post('/warden/rooms/vacate', { studentId: vacate!.id, reason: reason || undefined }));
          setVacate(null);
          if (r) {
            onChanged();
            onClose();
          }
        }}
      />
    </Modal>
  );
};
