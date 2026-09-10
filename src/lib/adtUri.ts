/**
 * ADT folds extra information into a URI fragment rather than into attributes,
 * and it does so in more than one place: an ATC finding carries its position
 * there, and a where-used hit inside a method carries the type its `adtObject`
 * element leaves out. Three shapes seen in the wild:
 *
 *   .../source/main#start=8,0
 *   .../source/main#type=CLAS%2FOM;name=IF_OO_ADT_CLASSRUN%7eMAIN;start=32
 *   .../oo/classes/foo/source/main#type=CLAS%2FOM;name=MEASURE_TIME;start=1
 *
 * The values are percent-encoded while the `;` and `=` separators are not, so
 * decoding has to happen per value and not on the fragment as a whole -
 * `CLAS%2FOM` is one value meaning `CLAS/OM`, not two fields.
 */
export function uriFragmentFields(uri: string): Record<string, string> {
  const hash = uri.indexOf('#');
  if (hash < 0) return {};

  const fields: Record<string, string> = {};
  for (const part of uri.slice(hash + 1).split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const key = part.slice(0, separator);
    const value = part.slice(separator + 1);
    try {
      fields[key] = decodeURIComponent(value);
    } catch {
      // A stray percent sign is not a reason to lose the rest of the fragment.
      fields[key] = value;
    }
  }
  return fields;
}
