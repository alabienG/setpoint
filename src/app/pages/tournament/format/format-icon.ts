import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormatId } from '../../../core/models';

/** Pictogrammes des formats, repris de la maquette. */
@Component({
  selector: 'app-format-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg width="56" height="40" viewBox="0 0 56 40" fill="none" stroke="#1D4ED8" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      @switch (format()) {
        @case ('pools') {
          <rect x="2" y="4" width="14" height="14" rx="3" />
          <rect x="2" y="22" width="14" height="14" rx="3" />
          <path d="M16 11h10v9h8M16 29h10v-9" />
          <rect x="36" y="14" width="16" height="12" rx="3" stroke="#C2410C" />
        }
        @case ('elim') {
          <path d="M2 4h10v8H2M2 28h10v8H2M12 8h8v24h-8M20 20h12" />
          <path d="M32 20h20" stroke="#C2410C" />
          <circle cx="50" cy="20" r="3" fill="#C2410C" stroke="#C2410C" />
        }
        @case ('double') {
          <path d="M2 4h10v8H2M12 8h8v6h12" />
          <path d="M2 28h10v8H2M12 32h8v-6h12" stroke="#C2410C" />
          <path d="M32 14v12M32 20h20" />
        }
        @case ('league') {
          <rect x="2" y="2" width="52" height="36" rx="4" />
          <path d="M2 14h52M2 26h52M20 2v36M38 2v36" />
          <path d="M24 6l10 4M24 30l10 4" stroke="#C2410C" />
        }
        @case ('swiss') {
          <path d="M4 8h12M4 20h12M4 32h12M22 8h12M22 20h12M22 32h12" />
          <path d="M40 8h12M40 20h12M40 32h12" stroke="#C2410C" />
        }
        @case ('melee') {
          <circle cx="10" cy="12" r="5" />
          <circle cx="28" cy="12" r="5" />
          <circle cx="46" cy="12" r="5" stroke="#C2410C" />
          <path d="M6 34c2-8 14-8 16 0M24 34c2-8 14-8 16 0" />
          <path d="M42 34c1-4 4-6 8-6" stroke="#C2410C" />
        }
      }
    </svg>
  `,
})
export class FormatIcon {
  readonly format = input.required<FormatId>();
}
