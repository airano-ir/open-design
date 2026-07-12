import { Icon } from './Icon';

interface Props {
  heading: string;
  title: string;
  description: string;
  actionLabel: string;
  onCreate: () => void;
}

export function EntryBlankState({
  heading,
  title,
  description,
  actionLabel,
  onCreate,
}: Props) {
  return (
    <div className="entry-section">
      <header className="entry-section__head">
        <h1 className="entry-section__title">{heading}</h1>
      </header>
      <div className="entry-blank">
        <div className="entry-blank__icon" aria-hidden>
          <Icon name="sparkles" size={26} />
        </div>
        <h2 className="entry-blank__title">{title}</h2>
        <p className="entry-blank__desc">{description}</p>
        <button type="button" className="entry-blank__cta" onClick={onCreate}>
          <Icon name="plus" size={15} /> {actionLabel}
        </button>
      </div>
    </div>
  );
}
