import React from 'react';
import type { WardenTabProps } from './WardenPortal';
import { PageHeader } from '../common/ui';
import { Incidents } from '../common/Incidents';

export const WardenIncidents: React.FC<WardenTabProps> = ({ onShowToast }) => (
  <div className="max-w-7xl mx-auto">
    <PageHeader title="Incident Reports" subtitle="Disciplinary, safety and welfare incidents filed by the Warden office and reviewed by the AO." icon="report" />
    <Incidents onShowToast={onShowToast} />
  </div>
);
