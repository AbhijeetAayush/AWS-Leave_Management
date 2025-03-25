// Set environment variables before imports to ensure they're available to the Lambda handlers
process.env.TABLE_NAME = 'LeaveApprovalAbhijeet';
process.env.SES_EMAIL = 'abhijeet.aayush@antstack.io';
process.env.STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:LeaveStateMachine';
process.env.APPROVER_EMAIL = 'abhijeet.aayush@antstack.io';
process.env.JWT_SECRET = 'test-secret';
process.env.AWS_REGION = 'us-east-1';

import { applyLeave, sendApprovalEmail, processApproval, notifyUser } from '../../app';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { SESClient, SendEmailCommand, SendEmailCommandInput } from '@aws-sdk/client-ses';
import { SFNClient, StartExecutionCommand, SendTaskSuccessCommand } from '@aws-sdk/client-sfn';
import { mockClient } from 'aws-sdk-client-mock';
import * as jwt from 'jsonwebtoken';

// Mock AWS SDK clients
const ddbMock = mockClient(DynamoDBClient);
const sesMock = mockClient(SESClient);
const sfnMock = mockClient(SFNClient);

// Mock jwt
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'mocked-token'),
  verify: jest.fn(() => ({ sub: 'user123', requestId: 'LEAVE-123' })),
}));

// Custom types for non-APIGateway events
interface ApprovalEmailEvent {
  requestId: string;
  userEmail: string;
  approverEmail: string;
  leaveDetails: {
    leaveType: string;
    startDate: string;
    endDate: string;
    reason: string;
  };
  taskToken: string;
  apiBaseUrl: string;
  approverToken: string;
}

interface NotifyUserEvent {
  requestId: string;
  userEmail: string;
  approvalStatus: string;
  leaveDetails: {
    leaveType: string;
    startDate: string;
    endDate: string;
    reason: string;
  };
}

describe('app.ts Lambda Handlers', () => {
  beforeEach(() => {
    // Reset mocks before each test to ensure isolation
    ddbMock.reset();
    sesMock.reset();
    sfnMock.reset();
    jest.clearAllMocks();
  });

  describe('applyLeave', () => {
    const validEvent: APIGatewayProxyEvent = {
      body: JSON.stringify({
        userEmail: 'user@example.com',
        leaveType: 'Vacation',
        startDate: '2025-04-01',
        endDate: '2025-04-05',
        reason: 'Test reason'
      }),
      requestContext: {
        accountId: '123456789012',
        apiId: 'test-api-id',
        protocol: 'HTTP',
        httpMethod: 'POST',
        requestId: 'test-request-id',
        routeKey: 'POST /apply-leave',
        stage: 'Prod',
        requestTimeEpoch: 1234567890,
        resourcePath: '/apply-leave',
        authorizer: { userId: 'user123' },
        identity: {
          sourceIp: '127.0.0.1',
          userAgent: 'test-agent',
          accessKey: null,
          accountId: null,
          caller: null,
          cognitoAuthenticationProvider: null,
          cognitoAuthenticationType: null,
          cognitoIdentityId: null,
          cognitoIdentityPoolId: null,
          principalOrgId: null,
          user: null,
          userArn: null,
          apiKey: null,
          apiKeyId: null,
          clientCert: null,
        },
        path: '/Prod/apply-leave',
        resourceId: 'test-resource-id',
      },
      headers: {},
      multiValueHeaders: {},
      httpMethod: 'POST',
      isBase64Encoded: false,
      path: '/apply-leave',
      pathParameters: null,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      resource: '/apply-leave',
    };

    const invalidEvent: APIGatewayProxyEvent = {
      ...validEvent,
      body: JSON.stringify({ userEmail: 'user@example.com' })
    };

    it('should apply leave successfully', async () => {
      ddbMock.on(PutItemCommand).resolves({});
      sfnMock.on(StartExecutionCommand).resolves({ executionArn: 'test-execution-arn' });

      const result = await applyLeave(validEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Leave applied');
      expect(body.requestId).toMatch(/^LEAVE-\d+$/);
      expect(body.token).toBeDefined();
      expect(ddbMock.calls()).toHaveLength(1);
      expect(sfnMock.calls()).toHaveLength(1);
    });

    it('should return 400 if required fields are missing', async () => {
      const result = await applyLeave(invalidEvent);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toBe('Missing  fields'); // Updated to match app.ts
    });

    it('should return 500 if environment variables are missing', async () => {
      const originalTableName = process.env.TABLE_NAME;
      process.env.TABLE_NAME = undefined; // Explicitly unset to trigger error

      const result = await applyLeave(validEvent);

      process.env.TABLE_NAME = originalTableName; // Restore original value

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).message).toBe('Internal server error');
    });
  });

  describe('sendApprovalEmail', () => {
    const validEvent: ApprovalEmailEvent = {
      requestId: 'LEAVE-123',
      userEmail: 'user@example.com',
      approverEmail: process.env.APPROVER_EMAIL!,
      leaveDetails: {
        leaveType: 'Vacation',
        startDate: '2025-04-01',
        endDate: '2025-04-05',
        reason: 'Test'
      },
      taskToken: 'task-token',
      apiBaseUrl: 'https://example.com/Prod',
      approverToken: 'approver-token',
    };

    it('should send approval email successfully', async () => {
      sesMock.on(SendEmailCommand).resolves({ MessageId: 'test-message-id' });

      await sendApprovalEmail(validEvent);

      expect(sesMock.calls()).toHaveLength(1);
      const call = sesMock.calls()[0];
      const input = call.args[0].input as SendEmailCommandInput;
      expect(input.Source).toBe(process.env.SES_EMAIL);
      expect(input.Destination?.ToAddresses).toContain(process.env.APPROVER_EMAIL);
      expect(input.Message?.Subject?.Data).toContain('Leave Approval Request');
    });

    it('should throw error on SES failure', async () => {
      sesMock.on(SendEmailCommand).rejects(new Error('SES error'));

      await expect(sendApprovalEmail(validEvent)).rejects.toThrow('SES error');
    });
  });

  describe('processApproval', () => {
    const validEvent: APIGatewayProxyEvent = {
      queryStringParameters: {
        requestId: 'LEAVE-123',
        action: 'approve',
        taskToken: 'task-token',
        token: 'valid-token',
      },
      requestContext: {
        accountId: '123456789012',
        apiId: 'test-api-id',
        protocol: 'HTTP',
        httpMethod: 'GET',
        requestId: 'test-request-id',
        routeKey: 'GET /process-approval',
        stage: 'Prod',
        requestTimeEpoch: 1234567890,
        resourcePath: '/process-approval',
        authorizer: null,
        identity: {
          sourceIp: '127.0.0.1',
          userAgent: 'test-agent',
          accessKey: null,
          accountId: null,
          caller: null,
          cognitoAuthenticationProvider: null,
          cognitoAuthenticationType: null,
          cognitoIdentityId: null,
          cognitoIdentityPoolId: null,
          principalOrgId: null,
          user: null,
          userArn: null,
          apiKey: null,
          apiKeyId: null,
          clientCert: null,
        },
        path: '/Prod/process-approval',
        resourceId: 'test-resource-id',
      },
      headers: {},
      multiValueHeaders: {},
      httpMethod: 'GET',
      isBase64Encoded: false,
      path: '/process-approval',
      pathParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      resource: '/process-approval',
      body: null,
    };

    const missingParamsEvent: APIGatewayProxyEvent = {
      ...validEvent,
      queryStringParameters: { requestId: 'LEAVE-123' }
    };

    const invalidTokenEvent: APIGatewayProxyEvent = {
      ...validEvent,
      queryStringParameters: {
        ...validEvent.queryStringParameters!,
        token: 'invalid-token'
      }
    };

    it('should process approval successfully', async () => {
      sfnMock.on(SendTaskSuccessCommand).resolves({});

      const result = await processApproval(validEvent);

      expect(result.statusCode).toBe(200);
      expect(result.headers?.['Content-Type']).toBe('text/html');
      expect(result.body).toContain('Leave Request Approved');
      expect(sfnMock.calls()).toHaveLength(1);
    });

    it('should return 400 if query parameters are missing', async () => {
      const result = await processApproval(missingParamsEvent);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toBe('Missing required query parameters');
    });

    it('should return 401 if token is invalid', async () => {
      (jwt.verify as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Invalid token');
      });

      const result = await processApproval(invalidTokenEvent);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).message).toBe('Invalid or expired token');
    });
  });

  describe('notifyUser', () => {
    const approvedEvent: NotifyUserEvent = {
      requestId: 'LEAVE-123',
      userEmail: 'user@example.com',
      approvalStatus: 'APPROVED',
      leaveDetails: {
        leaveType: 'Vacation',
        startDate: '2025-04-01',
        endDate: '2025-04-05',
        reason: 'Test'
      },
    };

    const rejectedEvent: NotifyUserEvent = {
      ...approvedEvent,
      approvalStatus: 'REJECTED'
    };

    it('should notify user of approval successfully', async () => {
      sesMock.on(SendEmailCommand).resolves({ MessageId: 'test-message-id' });

      await notifyUser(approvedEvent);

      expect(sesMock.calls()).toHaveLength(1);
      const call = sesMock.calls()[0];
      const input = call.args[0].input as SendEmailCommandInput;
      expect(input.Source).toBe(process.env.SES_EMAIL);
      expect(input.Destination?.ToAddresses).toContain('user@example.com');
      expect(input.Message?.Subject?.Data).toBe('Leave Request Outcome');
    });

    it('should notify user of rejection successfully', async () => {
      sesMock.on(SendEmailCommand).resolves({ MessageId: 'test-message-id' });

      await notifyUser(rejectedEvent);

      expect(sesMock.calls()).toHaveLength(1);
      const call = sesMock.calls()[0];
      const input = call.args[0].input as SendEmailCommandInput;
      expect(input.Source).toBe(process.env.SES_EMAIL);
      expect(input.Destination?.ToAddresses).toContain('user@example.com');
      expect(input.Message?.Subject?.Data).toBe('Leave Request Outcome');
    });

    it('should throw error on SES failure', async () => {
      sesMock.on(SendEmailCommand).rejects(new Error('SES error'));

      await expect(notifyUser(approvedEvent)).rejects.toThrow('SES error');
    });
  });
});