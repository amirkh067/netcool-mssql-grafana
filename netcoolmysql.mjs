import mysql from 'mysql2/promise';
import debugLib from 'debug';
import fetch from 'node-fetch';
import https from 'https';
import http from 'http';
import fs from 'fs';
import moment from 'moment';

const debug = debugLib('netcool');

// Replace with your MySQL connection details
const mysqlConfig = {
  host: 'mssql_ip',
  port: 3306,
  user: 'netcool',
  password: 'netcool123',
  database: 'netcool',
};

let lastFirstOccurrence = '';
try {
  lastFirstOccurrence = fs.readFileSync('lastFirstOccurrence.txt', 'utf8').trim();
  lastFirstOccurrence = new Date(Date.parse(lastFirstOccurrence));
  console.log('lastFirstOccurrence is :', lastFirstOccurrence);
} catch (err) {
  console.error(err);
}

const epochTime = lastFirstOccurrence instanceof Date ? lastFirstOccurrence.getTime() / 1000 : 'getdate%28%29-300';
const filter = lastFirstOccurrence instanceof Date ? `FirstOccurrence%20%3E%20${epochTime}` : 'FirstOccurrence%20%3E%20getdate%28%29-300';
console.log('Epoch Time:', epochTime);
console.log('Filter:', filter);

function encodeSQLToHTML(sqlQuery) {
  let encodedQuery = encodeURIComponent(sqlQuery)
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\!/g, '%21')
    .replace(/\'/g, '%27')
    .replace(/\~/g, '%7E')
    .replace(/\*/g, '%2A')
    .replace(/\//g, '%2F')
    .replace(/\:/g, '%3A')
    .replace(/\=/g, '%3D')
    .replace(/\?/g, '%3F')
    .replace(/\%20/g, '%20');

  return encodedQuery;
}

let sqlQuery = `Type IN (1,2,20,21)`;
let encodedQuery = encodeSQLToHTML(sqlQuery);

console.log('Encoded Query:', encodedQuery);

const alertsOptions = {
  hostname: 'Objectserver_ip',
  port: 8080,
  path: `/objectserver/restapi/alerts/status?filter=${encodedQuery}AND%20${filter}%20ORDER%20BY%20FirstOccurrence%20ASC`,
  method: 'GET',
  headers: {
    'Content-type': 'application/x-www-form-urlencoded',
    'Authorization': 'Basic ' + Buffer.from('root:').toString('base64'),
  },
};

console.log('Alerts Options Path:', alertsOptions.path);

const alertsReq = http.request(alertsOptions, async (alertsRes) => {
  debug('Alerts response status code:', alertsRes.statusCode);
  debug('Alerts response headers:', alertsRes.headers);
  let data = '';

  alertsRes.on('data', (chunk) => {
    data += chunk;
  });

  alertsRes.on('end', async () => {
    try {
      const response = JSON.parse(data);

      // Create a MySQL connection pool
      let pool;
      try {
        pool = mysql.createPool(mysqlConfig);
      } catch (error) {
        console.error('Error creating MySQL connection pool:', error);
        process.exit(1);
      }

      const connection = await pool.getConnection();
      try {
        for (let i = 0; i < response.rowset.rows.length; i++) {
          const Identifier = response.rowset.rows[i].Identifier;
          const serial = response.rowset.rows[i].Serial;
          //const firstOccurrence = response.rowset.rows[i].FirstOccurrence;
          const firstOccurrenceEpoch = response.rowset.rows[i].FirstOccurrence;
          const lastOccurrenceEpoch = response.rowset.rows[i].LastOccurrence;
          //const lastOccurrence = response.rowset.rows[i].LastOccurrence;
          const firstOccurrence = new Date(firstOccurrenceEpoch * 1000).toISOString().slice(0, 19).replace('T', ' ');
          const lastOccurrence = new Date(lastOccurrenceEpoch * 1000).toISOString().slice(0, 19).replace('T', ' ');
          const customerCode = response.rowset.rows[i].CustomerCode;
          const customer = response.rowset.rows[i].Customer;
          const node = response.rowset.rows[i].Node;
          const nodealias = response.rowset.rows[i].NodeAlias;
          const monsol = response.rowset.rows[i].MonitoringSolution;
          const summary = response.rowset.rows[i].Summary;
          const manager = response.rowset.rows[i].Manager;
          const alertkey = response.rowset.rows[i].AlertKey;
          const alertgroup = response.rowset.rows[i].AlertGroup;
          const component = response.rowset.rows[i].Component;
          const ticketnumber = response.rowset.rows[i].TicketNumber;
          const ticketgroup = response.rowset.rows[i].TicketGroup;
          const severity = response.rowset.rows[i].Severity;
          const originalseverity = response.rowset.rows[i].OriginalSeverity;
          const tally = response.rowset.rows[i].Tally;
          const type = response.rowset.rows[i].Type;
          const operatormessage = response.rowset.rows[i].OperatorMessage;

          if (i === response.rowset.rows.length - 1) {
            lastFirstOccurrence = new Date(firstOccurrenceEpoch * 1000);
            //lastFirstOccurrence = new Date(firstOccurrenceEpoch * 1000).toISOString().slice(0, 19).replace('T', ' ');
            debug('lastFirstOccurrence is:', lastFirstOccurrence);

            fs.writeFile('lastFirstOccurrence.txt', lastFirstOccurrence.toString(), function (err) {
              if (err) {
                debug('Error writing lastFirstOccurrence.txt:', err);
              } else {
                debug('lastFirstOccurrence.txt has been saved.');
              }
            });
          }
          try {
            // Insert data into MySQL
            const [rows, fields] = await connection.execute(
              `INSERT INTO netcool (Identifier, serial, firstOccurrence, lastOccurrence, customerCode, customer, node, nodealias, monsol, summary, manager, alertkey, alertgroup, component, ticketnumber, ticketgroup, severity, originalseverity, tally, type, operatormessage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                Identifier,
                serial,
                firstOccurrence,
                lastOccurrence,
                customerCode,
                customer,
                node,
                nodealias,
                monsol,
                summary,
                manager,
                alertkey,
                alertgroup,
                component,
                ticketnumber,
                ticketgroup,
                severity,
                originalseverity,
                tally,
                type,
                operatormessage
              ].map(value => (value !== undefined ? value : null))
            );

            debug('Data has been written to MySQL:', rows);
          } catch (error) {
            debug('Error writing data to MySQL:', error);
          }
        }
      } finally {
        connection.release();
      }
    } catch (parseError) {
      debug('Error parsing JSON response:', parseError);
    }
  });
});

alertsReq.on('error', (error) => {
  console.error(error);
});

alertsReq.end();