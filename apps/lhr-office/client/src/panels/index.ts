import type { ComponentType } from 'react';
import { Overview } from '../pages/Overview';
import { Approvals } from '../pages/Approvals';
import { AgentsAndJobs } from '../pages/AgentsAndJobs';
import { Research } from '../pages/Research';

export interface Panel {
  id: string;
  label: string;
  path: string;
  component: ComponentType;
}

export const panels: Panel[] = [
  { id: 'overview', label: 'Overview', path: '/', component: Overview },
  { id: 'approvals', label: 'Approvals', path: '/approvals', component: Approvals },
  { id: 'agents-jobs', label: 'Agents & Jobs', path: '/agents-jobs', component: AgentsAndJobs },
  { id: 'research', label: 'Research', path: '/research', component: Research },
];
