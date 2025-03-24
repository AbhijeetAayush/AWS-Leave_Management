import { APIGatewayTokenAuthorizerEvent, APIGatewayAuthorizerResult } from 'aws-lambda';
//import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
//import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import * as jwt from 'jsonwebtoken';


//const secretsClient = new SecretsManagerClient({});


//let cachedSecret: string | undefined;


/*const getJwtSecret = async (): Promise<string> => {
  if (cachedSecret) {
    return cachedSecret; 
  }
  const secretId = process.env.JWT_SECRET_ID || 'leave-approval/jwt-secret';

  try {
    const command = new GetSecretValueCommand({
        SecretId: secretId,
    });
    const response = await secretsClient.send(command);
    cachedSecret = response.SecretString;;
    if (!cachedSecret) {
      throw new Error('JWT secret not found in SSM');
    }
    return cachedSecret;
  } catch (error) {
    console.error('Error fetching JWT secret:', error);
    throw error; 
  }
};*/

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';
export const handler = async (event: APIGatewayTokenAuthorizerEvent): Promise<APIGatewayAuthorizerResult> => {
  try {
    
    const token = event.authorizationToken?.replace('Bearer ', '');
    if (!token) {
      throw new Error('No token provided');
    }

    
    //const secret = await getJwtSecret();

    
    const decoded = jwt.verify(token, JWT_SECRET) as { sub: string; scope?: string };
    const principalId = decoded.sub; 

    
    const policy = generatePolicy(principalId, 'Allow', event.methodArn, {
      userId: decoded.sub,
      scope: decoded.scope || 'user',
    });

    return policy;
  } catch (error) {
    console.error('Authorization error:', error);
    
    return generatePolicy('unauthorized', 'Deny', event.methodArn);
  }
};


const generatePolicy = (
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
  context?: { [key: string]: string }
): APIGatewayAuthorizerResult => {
  return {
    principalId, 
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resource, 
        },
      ],
    },
    context, 
  };
};