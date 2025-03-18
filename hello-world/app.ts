import { DynamoDBClient, UpdateItemCommand, PutItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

const dynamo = new DynamoDBClient({});
const ses = new SESClient({});
const TABLE_NAME = process.env.TABLE_NAME!;
const SES_EMAIL = process.env.SES_EMAIL!;

// Apply for Leave
export const applyLeave = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    console.log("TABLE_NAME:", TABLE_NAME, "SES_EMAIL:", SES_EMAIL);
    if (!TABLE_NAME || !SES_EMAIL) {
      throw new Error("Missing TABLE_NAME or SES_EMAIL in environment variables");
    }

    const body = JSON.parse(event.body || "{}");
    if (!body.userEmail || !body.leaveType || !body.startDate || !body.endDate) {
      return { statusCode: 400, body: JSON.stringify({ message: "Missing required fields" }) };
    }

    const requestId = `LEAVE-${Date.now()}`;
    console.log("Applying leave for:", body.userEmail, "Request ID:", requestId);

    await dynamo.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: {
        requestId: { S: requestId },
        userEmail: { S: body.userEmail },
        leaveType: { S: body.leaveType },
        startDate: { S: body.startDate },
        endDate: { S: body.endDate },
        reason: { S: body.reason || "Not provided" },
        status: { S: "PENDING" }
      }
    }));

    await sendApprovalEmail(requestId, body.userEmail);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Leave applied", requestId })
    };
  } catch (error) {
    console.error("Error in applyLeave:", error);
    return { statusCode: 500, body: JSON.stringify({ message: "Internal server error" }) };
  }
};

// Send Approval Email
export const sendApprovalEmail = async (requestId: string, userEmail: string) => {
  try {
    const emailParams = {
      Destination: { ToAddresses: [SES_EMAIL] },
      Message: {
        Body: { Text: { Data: `A leave request ${requestId} from ${userEmail} needs approval.` } },
        Subject: { Data: "Leave Approval Request" }
      },
      Source: SES_EMAIL
    };

    console.log("Sending approval email for request:", requestId);
    await ses.send(new SendEmailCommand(emailParams));
  } catch (error) {
    console.error("Error in sendApprovalEmail:", error);
  }
};

// Approve Leave
export const approveLeave = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { requestId, approved } = body;

    if (!requestId || approved === undefined) {
      return { statusCode: 400, body: JSON.stringify({ message: "requestId and approved status are required" }) };
    }

    console.log(`Updating leave request ${requestId} to ${approved ? "APPROVED" : "REJECTED"}`);

    await dynamo.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: { requestId: { S: requestId } },
      UpdateExpression: "SET #status = :s",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":s": { S: approved ? "APPROVED" : "REJECTED" } }
    }));

    await notifyUser(requestId, approved);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Leave status updated" })
    };
  } catch (error) {
    console.error("Error in approveLeave:", error);
    return { statusCode: 500, body: JSON.stringify({ message: "Internal server error" }) };
  }
};

// Notify User
export const notifyUser = async (requestId: string, approved: boolean) => {
  try {
    // Fetch the user's email from DynamoDB
    const { Item } = await dynamo.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: { requestId: { S: requestId } }
    }));

    if (!Item || !Item.userEmail) {
      console.error(`No user email found for requestId: ${requestId}`);
      return;
    }

    const userEmail = Item.userEmail.S;
    const statusText = approved ? "APPROVED" : "REJECTED";

    const emailParams = {
        Destination: { ToAddresses: [userEmail].filter((email): email is string => Boolean(email)) },
        Message: {
            Body: { Text: { Data: `Your leave request ${requestId} has been ${statusText}.` } },
            
          Subject: { Data: "Leave Approval Request" }
        },
        Source: SES_EMAIL
      };
      

    console.log("Notifying user:", userEmail, "Status:", statusText);
    await ses.send(new SendEmailCommand(emailParams));
  } catch (error) {
    console.error("Error in notifyUser:", error);
  }
};
