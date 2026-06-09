# Faizan Islamic School ERP - Setup & Deployment Guide
Developed by Oranzeb Khan Baloch

## 1. Prerequisites
- .NET 8 SDK
- Node.js (v18+) & Angular CLI (v17+)
- MySQL Server (v8+)
- Visual Studio 2022 or VS Code
- IIS (for production deployment)

## 2. Database Setup
1. Open MySQL Workbench or any MySQL client.
2. Run the script located at `/Database/FaizanIslamicSchool_MySQL.sql`.
3. Update the connection string in `Backend/FaizanIslamicSchool.WebApi/appsettings.json`.

## 3. Backend Setup
1. Navigate to the `Backend/` folder.
2. Open the solution in Visual Studio 2022.
3. Restore NuGet packages.
4. Update `appsettings.json` with your MySQL connection string and JWT secret.
5. Run the project (F5). The API will be available at `https://localhost:5001`.

## 4. Frontend Setup
1. Navigate to the `Frontend/` folder.
2. Run `npm install` to install dependencies.
3. Update `src/environments/environment.ts` with your backend API URL.
4. Run `ng serve` to start the development server.
5. Access the app at `http://localhost:4200`.

## 5. IIS Deployment Guide
### Backend Deployment:
1. Right-click the `FaizanIslamicSchool.WebApi` project in Visual Studio and select **Publish**.
2. Choose **Folder** as the target and publish to a local directory.
3. Open **IIS Manager**.
4. Right-click **Sites** > **Add Website**.
5. Set the **Physical Path** to your published folder.
6. Ensure the **Application Pool** is set to **No Managed Code** (for .NET Core).
7. Install the **ASP.NET Core Module v2** if not already installed.

### Frontend Deployment:
1. Run `ng build --configuration production` in the `Frontend/` folder.
2. Copy the contents of the `dist/` folder to your IIS website's physical path.
3. If deploying to a subfolder, update the `<base href="/">` in `index.html`.
4. Install the **URL Rewrite Module** in IIS to handle Angular routing.
5. Add a `web.config` file to the root of your Angular app with the following rule:
```xml
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="Angular Routes" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_DIRECTORY}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="./index.html" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
```

## 6. Default Credentials
- **Username:** admin
- **Password:** Admin@123
- **Role:** Super Admin
