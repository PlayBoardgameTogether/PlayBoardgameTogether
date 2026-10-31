import ts from 'typescript';
import { builtinModules } from 'node:module';
import { posix } from 'node:path';

export type Layer = 'browser' | 'protocol' | 'sdk' | 'client-sdk' | 'client' | 'server' | 'shared';
const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
const backendPackages = new Set(['pg', 'fastify', 'argon2', 'ws', 'nodemailer']);
const uiPackages = new Set(['react', 'react-dom']);

export function sourceImports(source: string, filename: string): string[] {
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) {
      imports.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
        node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      imports.push(node.arguments[0].text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteralLike(node.argument.literal)) {
      imports.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return imports;
}

export function forbiddenImport(layer: Layer, filename: string, specifier: string): boolean {
  const normalized = specifier.replaceAll('\\', '/');
  const target = normalized.startsWith('.')
    ? posix.normalize(posix.join(posix.dirname(filename.replaceAll('\\', '/')), normalized))
    : normalized;
  const packageName = normalized.startsWith('@') ? normalized.split('/').slice(0, 2).join('/') : normalized.split('/')[0]!;
  const nodeBuiltin = normalized.startsWith('node:') || builtins.has(normalized);
  const server = /(?:^|\/)server(?:\/|$)/.test(target);
  const api = /(?:^|\/)apps\/api(?:\/|$)/.test(target);
  const platform = /(?:^|\/)apps\/(?:api|web)(?:\/|$)/.test(target);
  const game = /(?:^|\/)games\//.test(target);
  const workspacePackage = normalized.startsWith('@boardgame/');

  if (layer === 'protocol' || layer === 'sdk') {
    const owner = layer === 'protocol' ? 'protocol' : 'game-sdk';
    return nodeBuiltin || backendPackages.has(packageName) || uiPackages.has(packageName) ||
      (workspacePackage && packageName !== `@boardgame/${owner}`) || platform || game ||
      (/(?:^|\/)packages\//.test(target) && !target.startsWith(`packages/${owner}/`));
  }
  if (layer === 'server') {
    return uiPackages.has(packageName) || backendPackages.has(packageName) || platform ||
      /(?:^|\/)client(?:\/|$)/.test(target) ||
      (workspacePackage && packageName !== '@boardgame/game-sdk');
  }
  if (nodeBuiltin || backendPackages.has(packageName) || server || api) return true;
  if (layer === 'shared') {
    return uiPackages.has(packageName) || platform || /(?:^|\/)client(?:\/|$)/.test(target) ||
      (workspacePackage && packageName !== '@boardgame/game-sdk');
  }
  if (layer === 'client-sdk') {
    return uiPackages.has(packageName) || platform || game ||
      (workspacePackage && !['@boardgame/protocol', '@boardgame/game-sdk'].includes(packageName));
  }
  return false;
}
