export interface TabSpec<T extends string> {
  id: T;
  label: string;
  /** Items needing a decision. Omit for tabs without a badge. */
  count?: number;
}

interface TypeTabBarProps<T extends string> {
  tabs: TabSpec<T>[];
  active: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  nested?: boolean;
}

export function TypeTabBar<T extends string>({ tabs, active, onChange, ariaLabel, nested }: TypeTabBarProps<T>) {
  return (
    <div className={nested ? 'workshop-tabs nested' : 'workshop-tabs'} role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          className={tab.id === active ? 'on' : undefined}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined && <span className={tab.count > 0 ? 'tab-count has-work' : 'tab-count'}>{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
