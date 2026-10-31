import { LANGUAGES } from "../lib/africa";

/** Suggestions for any input with list="kumbuka-languages". Rendered once per form. */
export default function LanguageList() {
  return <datalist id="kumbuka-languages">{LANGUAGES.map((l) => <option key={l} value={l} />)}</datalist>;
}
