import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Team } from '../core/models';

const PALETTE = ['#1D4ED8', '#C2410C', '#0F766E', '#7C3AED', '#B91C1C', '#0E7490', '#A16207', '#334155'];

export function initials(name: string): string {
  return name
    .replace(/^(Les|Le|La|L’|L')\s*/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

@Component({
  selector: 'app-team-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span aria-hidden="true" [style.background]="color()" [style.width.px]="size()" [style.height.px]="size()" [style.font-size.px]="size() * 0.34">{{ letters() }}</span>`,
  styles: `
    span {
      flex: none;
      border-radius: 28%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-weight: 700;
    }
  `,
})
export class TeamAvatar {
  readonly team = input.required<Team>();
  readonly size = input(44);
  protected readonly color = computed(() => PALETTE[this.team().color % PALETTE.length]);
  protected readonly letters = computed(() => initials(this.team().name));
}
