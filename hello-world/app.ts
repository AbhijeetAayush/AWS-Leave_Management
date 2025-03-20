import { DynamoDBClient, PutItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { SFNClient, StartExecutionCommand, SendTaskSuccessCommand } from "@aws-sdk/client-sfn"; // 
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

const dynamo = new DynamoDBClient({});
const ses = new SESClient({});
const sfn = new SFNClient({}); 
const TABLE_NAME = process.env.TABLE_NAME!;
const SES_EMAIL = process.env.SES_EMAIL!;
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN!; 
const APPROVER_EMAIL = process.env.APPROVER_EMAIL!;


export const applyLeave = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      if (!TABLE_NAME || !SES_EMAIL || !STATE_MACHINE_ARN) {
        throw new Error("Missing required environment variables");
      }
      //const APPROVER_EMAIL = process.env.APPROVER_EMAIL!;
  
      const body = JSON.parse(event.body || "{}");
      if (!body.userEmail || !body.leaveType || !body.startDate || !body.endDate ) {
        return { statusCode: 400, body: JSON.stringify({ message: "Missing required fields" }) };
      }
  
      const requestId = `LEAVE-${Date.now()}`;
      console.log("Applying leave for:", body.userEmail, "Request ID:", requestId);
  
      
      await dynamo.send(new PutItemCommand({
        TableName: TABLE_NAME,
        Item: {
          requestId: { S: requestId },
          userEmail: { S: body.userEmail },
          approverEmail: { S: APPROVER_EMAIL  },
          leaveType: { S: body.leaveType },
          startDate: { S: body.startDate },
          endDate: { S: body.endDate },
          reason: { S: body.reason || "Not provided" },
          status: { S: "PENDING" }
        }
      }));
  
      
      const apiBaseUrl = `https://${event.requestContext.domainName}/${event.requestContext.stage}`;
  
      
      const input = {
        requestId,
        userEmail: body.userEmail,
        approverEmail: APPROVER_EMAIL,
        leaveDetails: {
          leaveType: body.leaveType,
          startDate: body.startDate,
          endDate: body.endDate,
          reason: body.reason || "Not provided"
        },
        apiBaseUrl
      };
  
      await sfn.send(new StartExecutionCommand({
        stateMachineArn: STATE_MACHINE_ARN,
        input: JSON.stringify(input)
      }));
  
      return {
        statusCode: 200,
        body: JSON.stringify({ message: "Leave applied", requestId })
      };
    } catch (error) {
      console.error("Error in applyLeave:", error);
      return { statusCode: 500, body: JSON.stringify({ message: "Internal server error" }) };
    }
  };

export const sendApprovalEmail = async (event: any): Promise<void> => {
    try {
      const { requestId, userEmail, approverEmail, leaveDetails, taskToken, apiBaseUrl } = event;
  
     
      const approveUrl = `${apiBaseUrl}/process-approval?requestId=${requestId}&action=approve&taskToken=${encodeURIComponent(taskToken)}`;
      const rejectUrl = `${apiBaseUrl}/process-approval?requestId=${requestId}&action=reject&taskToken=${encodeURIComponent(taskToken)}`;
  
      const emailParams = {
        Destination: { ToAddresses: [approverEmail] },
        Message: {
          Body: {
            Html: {
              Data: `
                <html>
                  <body style="font-family: Arial, sans-serif; color: #333;">
                    <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
                      <h2 style="color: #007BFF;">Leave Approval Request</h2>
                      <p>Dear Approver,</p>
                      <p>A leave request (<strong>${requestId}</strong>) from <strong>${userEmail}</strong> requires your approval:</p>
                      
                      <h3 style="margin-top: 20px;">Leave Details</h3>
                      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <tr style="background-color: #f5f5f5;">
                          <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Field</th>
                          <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Details</th>
                        </tr>
                        <tr>
                          <td style="padding: 10px; border-bottom: 1px solid #ddd;">Leave Type</td>
                          <td style="padding: 10px; border-bottom: 1px solid #ddd;">${leaveDetails.leaveType}</td>
                        </tr>
                        <tr>
                          <td style="padding: 10px; border-bottom: 1px solid #ddd;">Start Date</td>
                          <td style="padding: 10px; border-bottom: 1px solid #ddd;">${leaveDetails.startDate}</td>
                        </tr>
                        <tr>
                          <td style="padding: 10px; border-bottom: 1px solid #ddd;">End Date</td>
                          <td style="padding: 10px; border-bottom: 1px solid #ddd;">${leaveDetails.endDate}</td>
                        </tr>
                        <tr>
                          <td style="padding: 10px; border-bottom: 1px solid #ddd;">Reason</td>
                          <td style="padding: 10px; border-bottom: 1px solid #ddd;">${leaveDetails.reason}</td>
                        </tr>
                      </table>
            
                      <p style="margin-bottom: 20px;">Please review the request and take action below:</p>
                      
                      <div style="text-align: center;">
                        <a href="${approveUrl}" 
                           style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 0 10px; font-weight: bold;">
                          Approve
                        </a>
                        <a href="${rejectUrl}" 
                           style="background-color: #f44336; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 0 10px; font-weight: bold;">
                          Reject
                        </a>
                      </div>
            
                      <p style="margin-top: 20px; font-size: 12px; color: #777;">
                        This is an automated message. Please do not reply directly to this email.
                      </p>
                    </div>
                  </body>
                </html>
              `
            }
          },
          Subject: { Data: "Leave Approval Request" }
        },
        Source: SES_EMAIL
      };
  
      console.log("Sending approval email for request:", requestId);
      await ses.send(new SendEmailCommand(emailParams));
    } catch (error) {
      console.error("Error in sendApprovalEmail:", error);
      throw error; 
    }
  };

export const processApproval = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const queryParams = event.queryStringParameters || {};
    const { requestId, action, taskToken } = queryParams;

    if (!requestId || !action || !taskToken) {
      return { statusCode: 400, body: JSON.stringify({ message: "Missing required query parameters" }) };
    }

    const approvalStatus = action === "approve" ? "APPROVED" : "REJECTED";
    console.log(`Processing ${approvalStatus} for request: ${requestId}`);

   
    await sfn.send(new SendTaskSuccessCommand({
      taskToken,
      output: JSON.stringify({ approvalStatus })
    }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html" },
      body: /*JSON.stringify({ message: `Leave request ${requestId} ${approvalStatus.toLowerCase()}` })*/
      `
        <html>
          <head>
            <title>Leave Request ${approvalStatus}</title>
          </head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background-color: #f5f5f5;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px; background-color: white; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
              <h1 style="color: ${approvalStatus === 'APPROVED' ? '#4CAF50' : '#f44336'};">
                Leave Request ${approvalStatus === 'APPROVED' ? 'Approved' : 'Rejected'}
              </h1>
              <p style="font-size: 18px; margin: 20px 0;">
                The leave request <strong>${requestId}</strong> has been successfully ${approvalStatus.toLowerCase()}.
              </p>
              <p style="color: #777;">
                ${
                  approvalStatus === 'APPROVED'
                    ? 'The employee has been notified of the approval.'
                    : 'The employee has been informed of the rejection.'
                }
              </p>
              <a href="https://your-dashboard.com" 
                 style="display: inline-block; padding: 12px 24px; background-color: #007BFF; color: white; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 20px;">
                Back to Dashboard
              </a>
              <p style="font-size: 14px; color: #999; margin-top: 30px;">
                If you have any questions, please contact HR support.
              </p>
            </div>
          </body>
        </html>
      `
    };
  } catch (error) {
    console.error("Error in processApproval:", error);
    return { statusCode: 500, body: JSON.stringify({ message: "Internal server error" }) };
  }
};


export const notifyUser = async (event: any): Promise<void> => {
  try {
    const { requestId, userEmail, approvalStatus, leaveDetails } = event;

    const statusText = approvalStatus === "APPROVED" ? "APPROVED" : "REJECTED";
    const emailParams = {
      Destination: { ToAddresses: [userEmail] },
      Message: {
        Body: {
          Html: {
            Data: `
              <html>
                <body style="font-family: Arial, sans-serif; color: #333;">
                  <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
                    <h2 style="color: ${statusText === 'APPROVED' ? '#4CAF50' : '#f44336'};">
                      Leave Request Update
                    </h2>
                    <p>Dear ${userEmail.split('@')[0]},</p>
                    <p>Your leave request (<strong>${requestId}</strong>) has been <strong>${statusText}</strong>.</p>
                    
                    <h3 style="margin-top: 20px;">Leave Details</h3>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                      <tr style="background-color: #f5f5f5;">
                        <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Field</th>
                        <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Details</th>
                      </tr>
                      <tr>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">Leave Type</td>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${leaveDetails.leaveType}</td>
                      </tr>
                      <tr>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">Start Date</td>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${leaveDetails.startDate}</td>
                      </tr>
                      <tr>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">End Date</td>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${leaveDetails.endDate}</td>
                      </tr>
                      <tr>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">Reason</td>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${leaveDetails.reason}</td>
                      </tr>
                    </table>
          
                    <p style="margin-bottom: 20px;">
                      ${
                        statusText === 'APPROVED'
                          ? 'Enjoy your time off! If you need to make changes, please contact your approver.'
                          : 'If you have questions, please reach out to your approver.'
                      }
                    </p>
          
                    <!-- Optional Interactive Button -->
                    <a href="https://your-dashboard.com/leave/${requestId}" 
                       style="background-color: #007BFF; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
                      View Detail
                    </a>
          
                    <p style="margin-top: 20px; font-size: 12px; color: #777;">
                      This is an automated message. Please do not reply directly to this email.
                    </p>
                  </div>
                </body>
              </html>
            `
          }
        },
        Subject: { Data: "Leave Request Outcome" }
      },
      Source: SES_EMAIL
    };

    console.log("Notifying user:", userEmail, "Status:", statusText);
    await ses.send(new SendEmailCommand(emailParams));
  } catch (error) {
    console.error("Error in notifyUser:", error);
    throw error; 
  }
};