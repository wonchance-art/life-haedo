'use strict';
/* No new SQL: reuse the existing isolated page/blob fixture under a fresh DB. */
const { LocalSQLSeriesCloud } = require('./blog-series-sql-fixture.cjs');
class LocalSQLNineCloud extends LocalSQLSeriesCloud {}
module.exports = { LocalSQLNineCloud };
