/**
 * GraphQL Schema Introspection
 * Fetch the schema for the Position entity to find better filter fields
 */

import { logger } from '../utils/logger';
import fetch from 'node-fetch';

async function introspectSchema() {
    logger.info('================================================================================');
    logger.info('GMX V2 GraphQL Schema Introspection');
    logger.info('================================================================================');

    const query = `
    query IntrospectionQuery {
      __type(name: "Position") {
        name
        fields {
          name
          type {
            name
            kind
            ofType {
              name
              kind
            }
          }
        }
      }
    }
  `;

    try {
        const response = await fetch('https://gmx.squids.live/gmx-synthetics-arbitrum:prod/api/graphql', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result: any = await response.json();

        if (result.data && result.data.__type) {
            logger.info('Position Entity Fields:');
            const fields = result.data.__type.fields;
            fields.sort((a: any, b: any) => a.name.localeCompare(b.name));

            for (const field of fields) {
                const typeName = field.type.name || (field.type.ofType ? field.type.ofType.name : 'Unknown');
                logger.info(`  - ${field.name}: ${typeName}`);
            }
        } else {
            logger.error('Could not find Position type in schema');
            logger.info('Full response:', JSON.stringify(result, null, 2));
        }

    } catch (error) {
        logger.error('Introspection failed:', error);
    }
}

introspectSchema();
