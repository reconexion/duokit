import { LANGS, useI18n } from '@/i18n';
import { cx } from '@/utils/cx';

export function LanguageSwitcher({ className }) {
  const { lang, setLang } = useI18n();
  return (
    <div role="group" aria-label="Idioma / Language" className={cx('inline-flex items-center gap-0.5 rounded-lg bg-secondary p-0.5', className)}>
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className={cx(
            'rounded-md px-2 py-1 text-xs font-semibold uppercase transition',
            lang === code ? 'bg-primary text-primary shadow-xs' : 'text-tertiary hover:text-primary',
          )}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
