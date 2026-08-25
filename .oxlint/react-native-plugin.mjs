/**
 * React Native lint rules for oxlint.
 *
 * oxlint has no native `react-native` plugin, and `eslint-plugin-react-native`
 * drags the whole ESLint runtime in as a peer dependency, which defeats the
 * point of moving off ESLint. These are self-contained reimplementations of the
 * rules we actually care about, using oxlint's ESLint-compatible plugin API.
 *
 * See https://oxc.rs/docs/guide/usage/linter/writing-js-plugins.html
 */

const STYLE_ATTRIBUTE = /style/i;
const COLOR_PROPERTY = /color/i;

/** `StyleSheet.create({ ... })` */
function isStyleSheetCreate(node) {
  return (
    node != null &&
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'create' &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === 'StyleSheet'
  );
}

/** A JSX attribute whose name looks like a style prop (`style`, `imageStyle`, …) */
function isStyleAttribute(node) {
  return (
    node.name?.type === 'JSXIdentifier' && STYLE_ATTRIBUTE.test(node.name.name)
  );
}

function propertyName(property) {
  if (property.type !== 'Property' || property.computed) return undefined;
  if (property.key.type === 'Identifier') return property.key.name;
  if (
    property.key.type === 'Literal' &&
    typeof property.key.value === 'string'
  ) {
    return property.key.value;
  }
  return undefined;
}

/** The object expressions a style prop resolves to, flattening `style={[a, b]}`. */
function styleObjectsFromAttribute(node) {
  const value = node.value;
  if (value?.type !== 'JSXExpressionContainer') return [];

  const expression = value.expression;
  if (expression.type === 'ObjectExpression') return [expression];
  if (expression.type === 'ArrayExpression') {
    return expression.elements.filter((el) => el?.type === 'ObjectExpression');
  }
  return [];
}

const noUnusedStyles = {
  meta: {
    docs: { description: 'Disallow unused styles in StyleSheet.create()' },
  },
  create(context) {
    // sheet name -> Map<style name, Property node>
    const sheets = new Map();
    const used = new Set();
    // Sheets accessed dynamically (`styles[key]`) can't be analysed statically.
    const dynamic = new Set();

    return {
      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier' || !isStyleSheetCreate(node.init)) {
          return;
        }
        const argument = node.init.arguments[0];
        if (argument?.type !== 'ObjectExpression') return;

        const styles = new Map();
        for (const property of argument.properties) {
          const name = propertyName(property);
          if (name === undefined) {
            // A spread or computed key means we can't see the full key set.
            dynamic.add(node.id.name);
            continue;
          }
          styles.set(name, property);
        }
        sheets.set(node.id.name, styles);
      },

      MemberExpression(node) {
        if (node.object.type !== 'Identifier') return;
        if (node.computed) {
          if (node.property.type === 'Literal') {
            used.add(`${node.object.name}.${node.property.value}`);
          } else {
            dynamic.add(node.object.name);
          }
          return;
        }
        if (node.property.type === 'Identifier') {
          used.add(`${node.object.name}.${node.property.name}`);
        }
      },

      // `const { container } = styles`
      'VariableDeclarator > ObjectPattern'(node) {
        const declarator = node.parent;
        if (declarator?.init?.type !== 'Identifier') return;
        for (const property of node.properties) {
          const name = propertyName(property);
          if (name === undefined) {
            dynamic.add(declarator.init.name);
          } else {
            used.add(`${declarator.init.name}.${name}`);
          }
        }
      },

      'Program:exit'() {
        for (const [sheetName, styles] of sheets) {
          if (dynamic.has(sheetName)) continue;
          for (const [styleName, property] of styles) {
            if (used.has(`${sheetName}.${styleName}`)) continue;
            context.report({
              node: property,
              message: `Unused style detected: ${sheetName}.${styleName}`,
            });
          }
        }
      },
    };
  },
};

const noSingleElementStyleArrays = {
  meta: {
    docs: {
      description:
        'Disallow single-element style arrays, which allocate a new array identity on every render',
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (!isStyleAttribute(node)) return;
        const expression = node.value?.expression;
        if (expression?.type !== 'ArrayExpression') return;
        if (expression.elements.length !== 1) return;
        if (expression.elements[0]?.type === 'SpreadElement') return;

        context.report({
          node: expression,
          message:
            'Single element style arrays are not necessary and cause unnecessary re-renders',
        });
      },
    };
  },
};

const noInlineStyles = {
  meta: {
    docs: {
      description:
        'Disallow inline style objects in JSX; move them into StyleSheet.create()',
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (!isStyleAttribute(node)) return;

        for (const object of styleObjectsFromAttribute(node)) {
          const names = object.properties
            .map(propertyName)
            .filter((name) => name !== undefined);
          if (names.length === 0) continue;

          context.report({
            node: object,
            message: `Inline style: { ${names.join(', ')} }`,
          });
        }
      },
    };
  },
};

const noColorLiterals = {
  meta: {
    docs: {
      description:
        'Disallow hard-coded color literals; reference a shared color instead',
    },
  },
  create(context) {
    function reportColorLiterals(object) {
      for (const property of object.properties) {
        const name = propertyName(property);
        if (name === undefined || !COLOR_PROPERTY.test(name)) continue;
        if (
          property.value.type !== 'Literal' ||
          typeof property.value.value !== 'string'
        ) {
          continue;
        }
        context.report({
          node: property,
          message: `Color literal: { ${name}: '${property.value.value}' }`,
        });
      }
    }

    return {
      CallExpression(node) {
        if (!isStyleSheetCreate(node)) return;
        const argument = node.arguments[0];
        if (argument?.type !== 'ObjectExpression') return;

        for (const property of argument.properties) {
          if (property.type !== 'Property') continue;
          if (property.value.type !== 'ObjectExpression') continue;
          reportColorLiterals(property.value);
        }
      },

      JSXAttribute(node) {
        if (!isStyleAttribute(node)) return;
        for (const object of styleObjectsFromAttribute(node)) {
          reportColorLiterals(object);
        }
      },
    };
  },
};

export default {
  meta: { name: 'react-native' },
  rules: {
    'no-unused-styles': noUnusedStyles,
    'no-single-element-style-arrays': noSingleElementStyleArrays,
    'no-inline-styles': noInlineStyles,
    'no-color-literals': noColorLiterals,
  },
};
