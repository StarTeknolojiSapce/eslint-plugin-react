/**
 * @fileoverview Report missing `key` props in iterators/collection literals.
 * @author Ben Mosher
 */

'use strict';

const hasProp = require('jsx-ast-utils/hasProp');
const propName = require('jsx-ast-utils/propName');
const values = require('object.values');
const docsUrl = require('../util/docsUrl');
const pragmaUtil = require('../util/pragma');
const report = require('../util/report');
const astUtil = require('../util/ast');

// ------------------------------------------------------------------------------
// Rule Definition
// ------------------------------------------------------------------------------

const defaultOptions = {
  checkFragmentShorthand: false,
  checkKeyMustBeforeSpread: false,
  warnOnDuplicates: false,
};

const messages = {
  missingIterKey: 'Missing "key" prop for element in iterator',
  missingIterKeyUsePrag: 'Missing "key" prop for element in iterator. Shorthand fragment syntax does not support providing keys. Use {{reactPrag}}.{{fragPrag}} instead',
  missingArrayKey: 'Missing "key" prop for element in array',
  missingArrayKeyUsePrag: 'Missing "key" prop for element in array. Shorthand fragment syntax does not support providing keys. Use {{reactPrag}}.{{fragPrag}} instead',
  keyBeforeSpread: '`key` prop must be placed before any `{...spread}, to avoid conflicting with React’s new JSX transform: https://reactjs.org/blog/2020/09/22/introducing-the-new-jsx-transform.html`',
  nonUniqueKeys: '`key` prop must be unique',
};

module.exports = {
  meta: {
    docs: {
      description: 'Disallow missing `key` props in iterators/collection literals',
      category: 'Possible Errors',
      recommended: true,
      url: docsUrl('jsx-key'),
    },

    messages,

    schema: [{
      type: 'object',
      properties: {
        checkFragmentShorthand: {
          type: 'boolean',
          default: defaultOptions.checkFragmentShorthand,
        },
        checkKeyMustBeforeSpread: {
          type: 'boolean',
          default: defaultOptions.checkKeyMustBeforeSpread,
        },
        warnOnDuplicates: {
          type: 'boolean',
          default: defaultOptions.warnOnDuplicates,
        },
      },
      additionalProperties: false,
    }],
  },

  create(context) {
    const options = Object.assign({}, defaultOptions, context.options[0]);
    const checkFragmentShorthand = options.checkFragmentShorthand;
    const checkKeyMustBeforeSpread = options.checkKeyMustBeforeSpread;
    const warnOnDuplicates = options.warnOnDuplicates;
    const reactPragma = pragmaUtil.getFromContext(context);
    const fragmentPragma = pragmaUtil.getFragmentFromContext(context);

    function checkIteratorElement(node) {
      if (node.type === 'JSXElement' && !hasProp(node.openingElement.attributes, 'key')) {
        report(context, messages.missingIterKey, 'missingIterKey', {
          node,
        });
      } else if (checkFragmentShorthand && node.type === 'JSXFragment') {
        report(context, messages.missingIterKeyUsePrag, 'missingIterKeyUsePrag', {
          node,
          data: {
            reactPrag: reactPragma,
            fragPrag: fragmentPragma,
          },
        });
      }
    }

    function getReturnStatements(node) {
      const returnStatements = arguments[1] || [];
      if (node.type === 'IfStatement') {
        if (node.consequent) {
          getReturnStatements(node.consequent, returnStatements);
        }
        if (node.alternate) {
          getReturnStatements(node.alternate, returnStatements);
        }
      } else if (Array.isArray(node.body)) {
        node.body.forEach((item) => {
          if (item.type === 'IfStatement') {
            getReturnStatements(item, returnStatements);
          }

          if (item.type === 'ReturnStatement') {
            returnStatements.push(item);
          }
        });
      }

      return returnStatements;
    }

    function isKeyAfterSpread(attributes) {
      let hasFoundSpread = false;
      return attributes.some((attribute) => {
        if (attribute.type === 'JSXSpreadAttribute') {
          hasFoundSpread = true;
          return false;
        }
        if (attribute.type !== 'JSXAttribute') {
          return false;
        }
        return hasFoundSpread && propName(attribute) === 'key';
      });
    }

    /**
     * Checks if the given node is a function expression or arrow function,
     * and checks if there is a missing key prop in return statement's arguments
     * @param {ASTNode} node
     */
    function checkFunctionsBlockStatement(node) {
      if (astUtil.isFunctionLikeExpression(node)) {
        if (node.body.type === 'BlockStatement') {
          getReturnStatements(node.body)
            .filter((returnStatement) => returnStatement && returnStatement.argument)
            .forEach((returnStatement) => {
              checkIteratorElement(returnStatement.argument);
            });
        }
      }
    }

    /**
     * Checks if the given node is an arrow function that has an JSX Element or JSX Fragment in its body,
     * and the JSX is missing a key prop
     * @param {ASTNode} node
     */
    function checkArrowFunctionWithJSX(node) {
      const isArrFn = node && node.type === 'ArrowFunctionExpression';

      if (isArrFn && (node.body.type === 'JSXElement' || node.body.type === 'JSXFragment')) {
        checkIteratorElement(node.body);
      }
    }

    const seen = new WeakSet();

    return {
      'ArrayExpression, JSXElement > JSXElement'(node) {
        const jsx = (node.type === 'ArrayExpression' ? node.elements : node.parent.children).filter((x) => x && x.type === 'JSXElement');
        if (jsx.length === 0) {
          return;
        }

        const map = {};
        jsx.forEach((element) => {
          const attrs = element.openingElement.attributes;
          const keys = attrs.filter((x) => x.name && x.name.name === 'key');

          if (keys.length === 0) {
            if (node.type === 'ArrayExpression') {
              report(context, messages.missingArrayKey, 'missingArrayKey', {
                node: element,
              });
            }
          } else {
            keys.forEach((attr) => {
              const value = context.getSourceCode().getText(attr.value);
              if (!map[value]) { map[value] = []; }
              map[value].push(attr);

              if (checkKeyMustBeforeSpread && isKeyAfterSpread(attrs)) {
                report(context, messages.keyBeforeSpread, 'keyBeforeSpread', {
                  node: node.type === 'ArrayExpression' ? node : node.parent,
                });
              }
            });
          }
        });

        if (warnOnDuplicates) {
          values(map).filter((v) => v.length > 1).forEach((v) => {
            v.forEach((n) => {
              if (!seen.has(n)) {
                seen.add(n);
                report(context, messages.nonUniqueKeys, 'nonUniqueKeys', {
                  node: n,
                });
              }
            });
          });
        }
      },

      JSXFragment(node) {
        if (!checkFragmentShorthand) {
          return;
        }

        if (node.parent.type === 'ArrayExpression') {
          report(context, messages.missingArrayKeyUsePrag, 'missingArrayKeyUsePrag', {
            node,
            data: {
              reactPrag: reactPragma,
              fragPrag: fragmentPragma,
            },
          });
        }
      },

      // Array.prototype.map
      // eslint-disable-next-line no-multi-str
      'CallExpression[callee.type="MemberExpression"][callee.property.name="map"],\
       CallExpression[callee.type="OptionalMemberExpression"][callee.property.name="map"],\
       OptionalCallExpression[callee.type="MemberExpression"][callee.property.name="map"],\
       OptionalCallExpression[callee.type="OptionalMemberExpression"][callee.property.name="map"]'(node) {
        const fn = node.arguments[0];
        if (!astUtil.isFunctionLikeExpression(fn)) {
          return;
        }

        checkArrowFunctionWithJSX(fn);

        checkFunctionsBlockStatement(fn);
      },

      // Array.from
      'CallExpression[callee.type="MemberExpression"][callee.property.name="from"]'(node) {
        const fn = node.arguments.length > 1 && node.arguments[1];

        if (!astUtil.isFunctionLikeExpression(fn)) {
          return;
        }

        checkArrowFunctionWithJSX(fn);

        checkFunctionsBlockStatement(fn);
      },
    };
  },
};
