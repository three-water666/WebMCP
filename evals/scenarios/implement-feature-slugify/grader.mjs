import { capture, check, gradeResult, importWorkspaceModule } from '../../graders/grade-utils.mjs';

export async function grade({ workspacePath }) {
  const loaded = await capture(() => importWorkspaceModule(workspacePath, 'src/slugify.mjs'));
  const slugify = loaded.ok ? loaded.value.slugify : undefined;
  const call = (...args) => capture(() => slugify(...args));
  const basic = await call('  Hello, World!  ');
  const accents = await call('Crème brûlée & Café');
  const separators = await call('one___two / three');
  const truncated = await call('alpha beta gamma', { maxLength: 11 });
  const badInput = await call(42);
  const badLength = await call('valid', { maxLength: 0 });

  return gradeResult([
    check('module-loads', 10, loaded.ok && typeof slugify === 'function', loaded.error ?? 'slugify is exported'),
    check('basic-normalization', 20, basic.value === 'hello-world', 'basic punctuation is normalized'),
    check('accents-and-ampersand', 25, accents.value === 'creme-brulee-and-cafe', 'accents and ampersand are normalized'),
    check('separator-runs', 15, separators.value === 'one-two-three', 'separator runs collapse'),
    check('safe-truncation', 15, truncated.value === 'alpha-beta', 'maxLength truncation removes trailing dash'),
    check('input-validation', 10, !badInput.ok && badInput.error === 'input must be a string', 'input type is validated'),
    check('option-validation', 5, !badLength.ok && badLength.error === 'maxLength must be a positive integer', 'maxLength is validated'),
  ]);
}
