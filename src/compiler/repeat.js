'use strict';

module.exports = {
  QUANTITIES: {'*': 0, '+': 1},

  toSexp: function() {
    var sexp = this.atom.toSexp();

    switch (this.quantifier.text) {
      case '*': sexp = ['repeat', 0, sexp]; break;
      case '+': sexp = ['repeat', 1, sexp]; break;
    }
    return sexp;
  },

  compile: function(builder, address, action) {
    var quantifier = this.quantifier.text;

    var minimum = this.QUANTITIES[quantifier],
        temp = builder.localVars_({
          remaining: minimum,
          index:     builder.offset_(),
          elements:  builder.emptyList_(),
          address:   builder.true_()
        }),

        remaining   = temp.remaining,
        startOffset = temp.index,
        elements    = temp.elements,
        elAddr      = temp.address;

    builder.whileNotNull_(elAddr, function(builder) {
      this.atom.compile(builder, elAddr);
      builder.ifNode_(elAddr, function(builder) {
        builder.append_(elements, elAddr);
        builder.decrement_(remaining);
      });
    }, this);

    builder.if_(builder.isZero_(remaining), function(builder) {
      builder.syntaxNode_(address, startOffset, builder.offset_(), elements, action);
    }, function(builder) {
      builder.assign_(address, builder.nullNode_());
    });
  }
};
